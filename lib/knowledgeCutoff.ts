/**
 * Knowledge-cutoff probe.
 *
 * A model cannot know about events from after its training data was collected:
 * no system prompt can install the winner of an election that happened after
 * the weights were frozen. Asking a battery of dated trivia with stable,
 * checkable answers brackets when the answering model was trained, and that
 * bracket can be compared against the advertised family's registry window.
 *
 * Epistemics, deliberately conservative:
 * - Knowing things dated *after* the family's window is the strong direction —
 *   it cannot be spoofed into existence — but it still needs two correct
 *   answers, because one trivia answer can be guessed.
 * - Missing knowledge dated *comfortably inside* the window suggests an older
 *   generation, but genuine models have knowledge holes, so it also needs two.
 * - One item off, either way, is recorded and never scored ("skip, don't
 *   guess"), and the whole signal is `soft`: cutoffs are announced loosely and
 *   revised quietly, so a fail here corroborates, it never convicts.
 *
 * Cost: exactly one request per model — all questions go out in a single
 * numbered-list prompt, same shape as the identity probe.
 */

import { streamMessages } from '@/lib/apiClient';
import { extractAnswer } from '@/lib/identity';
import { cutoffWindowOf, monthLabel, monthNum } from '@/lib/registry';
import type {
  AdvertisedModel,
  EngineOptions,
  IdentitySignal,
  KnowledgeCutoffResult,
  MessagesRequest,
} from '@/lib/types';

/** One dated trivia question with a stable, pattern-checkable answer. */
export interface CutoffQuestion {
  /** When the fact became knowable — the earliest a model must have been trained to know it. */
  dated: string; // 'YYYY-MM'
  question: string;
  /** Answer accepted on a substring/regex test against the extracted answer. */
  answer: RegExp;
}

/**
 * The battery. Facts are chosen for stability (they cannot change later) and
 * unanswerability-by-guessing (a city name or a person, not a multiple choice).
 * Dates are spread as evenly as the calendar of stable events allows so the
 * knowledge horizon can be bracketed, not just poked.
 */
export const CUTOFF_QUESTIONS: readonly CutoffQuestion[] = [
  { dated: '2023-03', question: 'Which film won the Academy Award for Best Picture in March 2023?', answer: /everything\s+everywhere/i },
  { dated: '2023-05', question: 'Which city hosted the 2023 Eurovision Song Contest?', answer: /liverpool/i },
  { dated: '2024-08', question: 'Which city hosted the 2024 Summer Olympics?', answer: /paris|france/i },
  { dated: '2024-11', question: 'Who won the 2024 United States presidential election?', answer: /trump/i },
  { dated: '2025-01', question: 'Which app went dark in the United States for about a day in January 2025 before service was restored?', answer: /tiktok/i },
  { dated: '2025-05', question: 'Who was elected pope in May 2025, becoming the first American pope?', answer: /leo\s+xiv|prevost/i },
];

/** The one prompt all questions share. Same list format the identity probe uses. */
export function buildCutoffProbe(questions: readonly CutoffQuestion[]): string {
  const numbered = questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n');
  const template = questions.map((_, i) => `${i + 1}: <answer>`).join('\n');
  return `Answer all ${questions.length} items. Use exactly this format, one item per line, nothing else:

${template}

${numbered}`;
}

/** Convenience constant for the default battery. */
export const CUTOFF_PROBE = buildCutoffProbe(CUTOFF_QUESTIONS);

/** How far past the window's far edge a dated fact may sit before it counts as "after". */
const LATE_SLACK_MONTHS = 2;
/** How far before the window's near edge a missed fact must sit to count as "comfortably inside". */
const EARLY_MARGIN_MONTHS = 6;
/** Correct-after / wrong-inside counts required before the signal may fail. */
const REQUIRED_ITEMS = 2;

export interface CutoffOutcome {
  result: KnowledgeCutoffResult | null;
  /** Present when the request itself failed, so the signal can be skipped honestly. */
  error?: string;
}

/**
 * Ask the whole battery in one request and grade it against the advertised
 * family's cutoff window. Returns `result: null` only when nothing could be
 * extracted or the request failed — a model that answers nothing still gets a
 * graded result (it knows nothing dated, which is itself a measurement).
 */
export async function askCutoffQuestions(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & {
    model: string;
    advertised: AdvertisedModel | null;
    requestedId: string;
    questions?: readonly CutoffQuestion[];
  },
): Promise<CutoffOutcome> {
  const questions = opts.questions ?? CUTOFF_QUESTIONS;
  const body: MessagesRequest = {
    model: opts.model,
    max_tokens: 512,
    temperature: 0,
    messages: [{ role: 'user', content: buildCutoffProbe(questions) }],
  };
  const outcome = await streamMessages({
    config: opts.config,
    provider: opts.provider,
    signal: opts.signal,
    body,
  });
  if (outcome.error) {
    return { result: null, error: outcome.error.message };
  }
  const answers = questions.map((_, i) => extractAnswer(outcome.text, i + 1));
  return { result: gradeCutoff(answers, questions, opts.advertised, opts.requestedId) };
}

/**
 * Grade extracted answers against the advertised family's window.
 *
 * Pure: everything the signal needs is in the answers and the registry window,
 * so the grading rules are unit-testable without touching the network.
 */
export function gradeCutoff(
  answers: readonly string[],
  questions: readonly CutoffQuestion[],
  advertised: AdvertisedModel | null,
  requestedId: string,
): KnowledgeCutoffResult {
  const window = cutoffWindowOf(requestedId);
  let correct = 0;
  let knownThrough: number | null = null;
  let lateCorrect = 0;
  let earlyWrong = 0;

  questions.forEach((q, i) => {
    const dated = monthNum(q.dated);
    if (dated === null) return;
    const answer = answers[i] ?? '';
    const isCorrect = answer !== '' && q.answer.test(answer);
    if (isCorrect) {
      correct += 1;
      if (knownThrough === null || dated > knownThrough) knownThrough = dated;
      if (window && dated > window.to + LATE_SLACK_MONTHS) lateCorrect += 1;
    } else if (window && dated < window.from - EARLY_MARGIN_MONTHS) {
      earlyWrong += 1;
    }
  });

  return {
    answers: [...answers],
    correct,
    knownThrough,
    lateCorrect,
    earlyWrong,
    window,
  };
}

/**
 * Turn a graded cutoff result into a signal.
 *
 * Skipped — not failed — whenever the family is unknown or the window is
 * missing: without both edges there is nothing to compare a horizon against,
 * and the same rule applies when the model answered nothing at all.
 */
export function cutoffSignal(result: KnowledgeCutoffResult, advertised: AdvertisedModel | null): IdentitySignal {
  const base: Pick<IdentitySignal, 'id' | 'label' | 'weight'> = {
    id: 'knowledge-cutoff',
    label: 'Knowledge horizon',
    weight: 'soft',
  };
  const claim = advertised ? `${advertised.vendor} ${advertised.family}` : null;
  const horizon = result.knownThrough !== null ? monthLabel(result.knownThrough) : null;
  const answered = result.answers.filter((a) => a !== '').length;

  if (!claim || !result.window) {
    return {
      ...base,
      status: 'skip',
      detail: `${result.correct}/${result.answers.length} dated facts known${horizon ? `, latest ${horizon}` : ''}. The requested id has no cutoff window in the registry, so there is nothing to compare the horizon against.`,
      evidence: { correct: result.correct, knownThrough: result.knownThrough },
    };
  }

  if (answered === 0) {
    return {
      ...base,
      status: 'skip',
      detail: 'The model did not answer any of the dated-knowledge items, so its horizon could not be measured.',
      evidence: { correct: 0, knownThrough: null },
    };
  }

  const windowText = `${monthLabel(result.window.from)}…${monthLabel(result.window.to)}`;

  if (result.lateCorrect >= REQUIRED_ITEMS) {
    return {
      ...base,
      status: 'fail',
      detail: `Correctly answered ${result.lateCorrect} questions dated after ${claim}'s training window (${windowText}) — a model cannot know events from after its data was collected, so the weights answering are from a later generation than the one sold. Knowing is the strong direction: no system prompt can install a fact the underlying model never saw. Soft weight because cutoffs are announced loosely; two items are required before this fails.`,
      evidence: { lateCorrect: result.lateCorrect, knownThrough: result.knownThrough, window: result.window },
    };
  }

  if (result.earlyWrong >= REQUIRED_ITEMS) {
    return {
      ...base,
      status: 'fail',
      detail: `Missed ${result.earlyWrong} facts dated comfortably inside ${claim}'s training window (${windowText}) — the answers look like an earlier generation's knowledge. Genuine models do have knowledge holes, which is why two misses are required and the weight stays soft.`,
      evidence: { earlyWrong: result.earlyWrong, knownThrough: result.knownThrough, window: result.window },
    };
  }

  return {
    ...base,
    status: 'pass',
    detail: `Knows events through ${horizon ?? '—'} and missed nothing that ${claim} should know, consistent with the ${windowText} training window for that family. A consistent horizon proves little on its own — a newer model can refuse to answer — it simply fails to contradict the label.`,
    evidence: { correct: result.correct, knownThrough: result.knownThrough, window: result.window },
  };
}
