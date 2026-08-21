import { proxy, streamMessages } from '@/lib/apiClient';
import { classifyError } from '@/lib/errors';
import {
  detectVendor,
  expectedLimits,
  extractModelIds,
  familiesWithCeiling,
  probeModelResolution,
  probeOutputCeiling,
  probeVendor,
  rankFamilyCandidates,
  scanHeadersForModel,
} from '@/lib/attribution';
import { askCutoffQuestions, cutoffSignal } from '@/lib/knowledgeCutoff';
import { VENDOR_LABEL, bareId, familyOf, isSmallModel, vendorOf, type VendorId } from '@/lib/registry';
import { histogram, jensenShannon, sampleRandomNumbers } from '@/lib/randomFingerprint';
import type {
  AdvertisedModel,
  Attribution,
  EngineOptions,
  IdentityReport,
  IdentityRun,
  IdentitySignal,
  IdentitySignalId,
  IdentityVerdict,
  MessagesRequest,
  NameSource,
  RandomNumberFingerprint,
  SignalWeight,
  Usage,
} from '@/lib/types';

/**
 * Identity probe: does this endpoint serve the model it sells?
 *
 * Nothing here trusts what the model says about itself. A model that answers "I
 * am Claude Opus" has proved nothing — that sentence is one line of system
 * prompt away for any model on earth. What cannot be faked cheaply is the
 * serving stack's own bookkeeping: the model id on the response, the id named in
 * a validation error, the tokenizer's count for a fixed string, the output cap
 * the API enforces. Those are what decide a verdict here; the model's own claims
 * are recorded as quotes for the user to read, and scored only when they
 * contradict the advertised vendor.
 */
/**
 * Items 6–8 were added because the class of 2026 was specifically tuned on the
 * famous items: "strawberry" letter counts and 17 × 24 now appear in training
 * data, so small models pass them and the items no longer separate tiers. The
 * nonce word restores the letter-counting test (it cannot have been trained
 * on), 847 × 36 restores the arithmetic one, and the seven-word constraint is
 * a stricter instruction-following test than a single fixed word.
 */
export const IDENTITY_PROBE = `Answer all eight items. Use exactly this format, one item per line, nothing else:

1: <answer>
2: <answer>
3: <answer>
4: <answer>
5: <answer>
6: <answer>
7: <answer>
8: <answer>

1. What is 17 * 24?
2. How many times does the letter r appear in the word strawberry?
3. Write the single Python expression that sums the integers 1 through 100 inclusive.
4. Reply with the single word: ORANGE
5. Which AI model are you? Give the exact model name only.
6. What is 847 * 36?
7. How many times does the letter r appear in the word retrospectrometer?
8. Reply with exactly seven words.`;

/**
 * Fixed text for the tokenizer fingerprint. Deliberately mixes scripts,
 * contractions, numbers and rare substrings — the places where different
 * tokenizer vocabularies disagree most.
 */
export const TOKENIZER_PROBE_TEXT =
  'The quick brown fox jumps over 13 lazy dogs. ' +
  "It wouldn't've been unimaginable—antidisestablishmentarianism, tokenization, 東京, café, naïve. " +
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 !@#$%^&*() ' +
  'supercalifragilisticexpialidocious pneumonoultramicroscopicsilicovolcanoconiosis. ' +
  'def f(x): return x**2 + 1  # comment\n' +
  'SELECT * FROM users WHERE id = 42 AND name LIKE \'%test%\';';

/**
 * How far a model's token count may sit from its cohort before it counts as a
 * different tokenizer. Models from one vendor generation share a tokenizer, so
 * genuine siblings return the same count for the same text; a few percent of
 * slack absorbs gateways that add their own system preamble.
 */
const TOKENIZER_TOLERANCE = 0.05;

/** Token slack between count_tokens and billed input before a gap counts as injection. Absorbs fixed message-framing overhead. */
const INJECTION_TOLERANCE = 15;

const RUNS = 3;
const MAX_TOKENS = 512;

/** Default number of single-token random-number samples per model. */
const FINGERPRINT_SAMPLES = 40;

/* ------------------------------------------------------------------ */
/* Deterministic answer checking                                       */
/* ------------------------------------------------------------------ */

/**
 * Pull the answer for a numbered item out of the model's reply. Models wrap the
 * marker in markdown often enough (`**1.** 408`) that the closing asterisks have
 * to be stripped after the separator too, not just before it.
 */
export function extractAnswer(text: string, item: number): string {
  const marker = `^\\**\\s*${item}\\**\\s*[:.)]`;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => new RegExp(marker).test(l));
  if (!line) return '';
  return line.replace(new RegExp(`${marker}\\s*\\**\\s*`), '').trim();
}

/** 17 * 24 = 408. Accept thousands separators, reject anything else. */
export function checksArithmetic(answer: string): boolean {
  const digits = answer.replace(/[,\s_]/g, '');
  return /(^|[^\d])408([^\d]|$)/.test(digits);
}

/** "strawberry" contains three r's. The classic tokenizer-blind failure. */
export function checksStrawberry(answer: string): boolean {
  return /\b(three|3)\b/i.test(answer);
}

/** Any correct one-liner: sum(range(1,101)) and its equivalents. */
export function checksPythonSum(answer: string): boolean {
  const a = answer.toLowerCase().replace(/\s/g, '');
  if (/sum\(range\(1,101\)\)/.test(a)) return true;
  if (/sum\(range\(101\)\)/.test(a)) return true;
  return /\b5050\b/.test(a);
}

/** 847 * 36 = 30492. Harder than 17 × 24, which small models now reliably pass. */
export function checksHardArithmetic(answer: string): boolean {
  const digits = answer.replace(/[,\s_]/g, '');
  return /(^|[^\d])30492([^\d]|$)/.test(digits);
}

/** "retrospectrometer" — a nonce word — contains four r's. Not a fine-tuning target. */
export function checksNonceCount(answer: string): boolean {
  return /\b(four|4)\b/i.test(answer);
}

/**
 * Item 8: exactly seven words. Markdown decoration is stripped before counting
 * so `**word**` is one word, but hyphenated compounds count as one word too —
 * the count is of whitespace-separated tokens, as for any word-count rule.
 */
export function checksSevenWords(answer: string): boolean {
  const cleaned = answer.replace(/[*`_]/g, '').trim();
  if (!cleaned) return false;
  return cleaned.split(/\s+/).length === 7;
}

/** Instruction following: item 4 must be exactly ORANGE. */
export function checksLiteral(answer: string): boolean {
  return /^\**orange\**[.!]?$/i.test(answer.trim());
}

/**
 * Which vendor the model named for itself.
 *
 * Evidence only. A match with the advertised vendor proves nothing (it is the
 * one thing a reseller would prompt for); a mismatch is a real lead.
 */
export function readsClaimedVendor(answer: string): { vendor: string | null; vendorId: VendorId | null } {
  const guess = detectVendor([answer]);
  return { vendor: guess.vendor, vendorId: guess.vendorId };
}

/* ------------------------------------------------------------------ */
/* Tokenizer fingerprint                                              */
/* ------------------------------------------------------------------ */

export interface TokenCountOutcome {
  count: number | null;
  available: boolean;
  detail: string;
}

/**
 * Ask the provider to count tokens for a fixed string. The count comes from the
 * model's own tokenizer, so a backend quietly serving a different model family
 * reports a different number. Gateways that don't implement the endpoint return
 * `available: false` and the signal is skipped rather than counted against them.
 */
export async function countTokens(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string; text?: string },
): Promise<TokenCountOutcome> {
  const res = await proxy<{ input_tokens?: number }>({
    config: opts.config,
    path: '/v1/messages/count_tokens',
    method: 'POST',
    provider: opts.provider,
    signal: opts.signal,
    body: {
      model: opts.model,
      messages: [{ role: 'user', content: opts.text ?? TOKENIZER_PROBE_TEXT }],
    },
  });

  if (!res.ok || !res.data) {
    return {
      count: null,
      available: false,
      detail:
        res.status === 404
          ? 'Provider does not implement /v1/messages/count_tokens.'
          : `count_tokens unavailable (${res.status || 'network error'}).`,
    };
  }
  const count = typeof res.data.input_tokens === 'number' ? res.data.input_tokens : null;
  if (count === null) {
    return { count: null, available: false, detail: 'count_tokens returned no input_tokens field.' };
  }
  return { count, available: true, detail: `Reported ${count} tokens.` };
}

/** Total input the backend actually processed, cache buckets included. Null when usage is absent. */
export function billedInputTokens(usage: Usage | null | undefined): number | null {
  if (!usage || typeof usage.input_tokens !== 'number') return null;
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

/* ------------------------------------------------------------------ */
/* Verdict aggregation                                                 */
/* ------------------------------------------------------------------ */

interface Tally {
  hardFails: number;
  softFails: number;
  passes: number;
  scored: number;
}

/**
 * Count only what a signal's own weight says may be counted.
 *
 * `context` signals are excluded by design: an endpoint that ignores model names
 * is a serious finding about the provider, but it is not evidence that *this*
 * response came from the wrong model, and letting it fail a model would produce
 * confident accusations from ambiguous facts.
 */
function tally(signals: readonly IdentitySignal[]): Tally {
  let hardFails = 0;
  let softFails = 0;
  let passes = 0;
  let scored = 0;
  for (const s of signals) {
    if (s.weight === 'context') continue;
    if (s.status === 'skip' || s.status === 'pending' || s.status === 'running') continue;
    scored += 1;
    if (s.status === 'pass') passes += 1;
    else if (s.status === 'fail' && s.weight === 'hard') hardFails += 1;
    else softFails += 1;
  }
  return { hardFails, softFails, passes, scored };
}

/**
 * Turn the signals into one verdict.
 *
 * Order matters and encodes what counts as proof. A named substitution comes
 * first because it cannot be averaged away: when the endpoint itself reports a
 * different model than the one requested, every behavioural check passing is
 * beside the point — it really is a working model, just not the one sold. Only
 * then do verifiable wrong answers decide, and only then the pass ratio.
 */
export function aggregateVerdict(
  signals: readonly IdentitySignal[],
  mismatch?: { vendor?: boolean; family?: boolean },
): { verdict: IdentityVerdict; confidence: number } {
  const { hardFails, softFails, passes, scored } = tally(signals);

  if (mismatch?.vendor) return { verdict: 'different-vendor', confidence: 96 };
  if (mismatch?.family) return { verdict: 'wrong-tier', confidence: 94 };

  if (scored === 0) return { verdict: 'ambiguous', confidence: 0 };

  if (hardFails >= 2) return { verdict: 'mismatch', confidence: Math.min(95, 60 + hardFails * 15) };
  if (hardFails === 1) return { verdict: 'likely-mismatch', confidence: 70 };

  const ratio = passes / scored;
  if (softFails === 0 && ratio === 1) {
    return { verdict: 'matches-advertised', confidence: Math.min(95, 60 + scored * 8) };
  }
  if (ratio >= 0.7) return { verdict: 'likely-advertised', confidence: Math.round(ratio * 80) };
  if (ratio >= 0.4) return { verdict: 'ambiguous', confidence: 40 };
  return { verdict: 'likely-mismatch', confidence: Math.round((1 - ratio) * 70) };
}

export const VERDICT_LABEL: Record<IdentityVerdict, string> = {
  'matches-advertised': 'Matches what was sold',
  'likely-advertised': 'Likely as advertised',
  'wrong-tier': 'Wrong model tier',
  'different-vendor': 'Different vendor entirely',
  ambiguous: 'Inconclusive',
  'likely-mismatch': 'Likely not as advertised',
  mismatch: 'Not the advertised model',
  error: 'Could not verify',
};

/** One-line explanation of each verdict, shown inline on the row and in tooltips. */
export const VERDICT_BLURB: Record<IdentityVerdict, string> = {
  'matches-advertised': 'Every check the endpoint allowed is consistent with the model you asked for.',
  'likely-advertised': 'Mostly consistent with the advertised model, with something unexplained.',
  'wrong-tier': 'A real model from the right vendor, but a different tier than the one sold.',
  'different-vendor': "Answered by a different company's model than the id claims.",
  ambiguous: 'The endpoint gave away too little to say either way.',
  'likely-mismatch': 'A verifiable contradiction with the advertised model.',
  mismatch: 'Several verifiable contradictions — this is not the model advertised.',
  error: 'The probe could not complete, so nothing was established.',
};

/**
 * The pass/partial/fail tone each verdict is drawn in, shared by the pill and
 * the inline verdict line so the two can never disagree about colour. Tone is
 * reinforcement only — every place that uses it also carries an icon or words.
 */
export const VERDICT_TONE: Record<IdentityVerdict, 'pass' | 'partial' | 'fail' | 'pending'> = {
  'matches-advertised': 'pass',
  'likely-advertised': 'pass',
  // A real model from the right vendor, just not the tier that was ordered — a
  // billing problem rather than a fake, but still not what was sold, so fail.
  'wrong-tier': 'fail',
  'different-vendor': 'fail',
  ambiguous: 'partial',
  'likely-mismatch': 'fail',
  mismatch: 'fail',
  error: 'pending',
};

/* ------------------------------------------------------------------ */
/* The verifier                                                        */
/* ------------------------------------------------------------------ */

export interface VerifyOptions extends EngineOptions {
  model: string;
  runs?: number;
  /** Skip the tokenizer probe (e.g. when a provider is known to 404 it). */
  skipTokenizer?: boolean;
  /**
   * Expected token count for TOKENIZER_PROBE_TEXT, taken from the cohort of
   * models on this same endpoint (see `tokenizerBaseline`). Without it the count
   * is reported but not scored — an absolute number can't be trusted unless it
   * was measured against a known-good reference.
   */
  tokenizerBaseline?: number | null;
  /**
   * Also work out *which* model it is: probe the output ceiling, test whether the
   * endpoint routes on model names, and ask what vendor trained it. Costs about
   * four extra requests, so it is opt-in.
   */
  attribute?: boolean;
  /**
   * Also run the random-number distributional fingerprint: fire many cheap
   * single-token requests, build the model's "random" distribution, and compare
   * it (via Jensen–Shannon divergence) against a cohort baseline. Costs
   * `fingerprintSamples` extra requests, so it is opt-in and separate from
   * `attribute`.
   */
  fingerprint?: boolean;
  /** How many random-number samples to collect. Defaults to FINGERPRINT_SAMPLES. */
  fingerprintSamples?: number;
  /**
   * Baseline distribution to compare this model's fingerprint against, typically
   * the cohort median across the endpoint's models. When absent, the fingerprint
   * is recorded but left unscored.
   */
  fingerprintBaseline?: number[] | null;
  /**
   * A distribution already sampled by the caller. When provided, the verifier
   * skips its own sampling and scores this instead — used by the cohort flow,
   * which samples every model once to build the baseline and reuses those same
   * samples for scoring rather than paying for a second round of requests.
   */
  fingerprintDistribution?: { distribution: number[]; attempted: number; parsed: number } | null;
  /**
   * Data-driven divergence cutoff, learned by the caller from the cohort's own
   * spread (see `cohortDivergenceThreshold`). When absent, the fingerprint is
   * recorded but not scored — there is no defensible cutoff for a lone model.
   */
  fingerprintThreshold?: number | null;
}

/**
 * Median token count across an endpoint's models.
 *
 * This is what makes the tokenizer check work without a hardcoded constant: one
 * vendor generation shares one tokenizer, so a consistent lineup returns one
 * identical count. A model whose count diverges from its siblings is being served
 * by a different tokenizer, whatever the provider calls it.
 */
export function tokenizerBaseline(counts: readonly number[]): number | null {
  const valid = counts.filter((c) => Number.isFinite(c) && c > 0).slice().sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? Math.round((valid[mid - 1]! + valid[mid]!) / 2) : valid[mid]!;
}

/** What the requested id claims to be, in display form. */
export function advertisedOf(modelId: string): AdvertisedModel | null {
  const limits = expectedLimits(modelId);
  if (!limits) return null;
  return {
    vendor: VENDOR_LABEL[limits.vendor],
    family: limits.family,
    output: limits.output,
    context: limits.context,
    capsExact: limits.caps === 'exact',
  };
}

function blankReport(modelId: string): IdentityReport {
  return {
    modelId,
    verdict: 'ambiguous',
    confidence: 0,
    signals: [],
    runs: [],
    tokenizerCount: null,
    advertised: advertisedOf(modelId),
    attribution: null,
    fingerprint: null,
    cutoff: null,
    stylometry: null,
    error: null,
    at: Date.now(),
  };
}

/**
 * Decide which model id is actually serving the request.
 *
 * Sources are tried strongest first. The API's own `model` field and any id the
 * endpoint names in its validation errors are both statements from the serving
 * stack; a header is nearly as good; the model's own claim is worth least, since
 * that is exactly what a spoofing prompt rewrites.
 */
export function resolveServedModel(input: {
  requested: string;
  reportedModels: readonly (string | null)[];
  errorIds: readonly string[];
  headerIds: readonly string[];
}): { id: string | null; source: NameSource } {
  const reported = input.reportedModels.find((m): m is string => typeof m === 'string' && m.trim() !== '');
  if (reported) return { id: reported, source: 'response-model' };

  // Prefer an id that disagrees with the request: agreement tells us nothing new,
  // disagreement is the whole finding.
  const requested = input.requested.toLowerCase();
  const errorMismatch = input.errorIds.find((id) => id !== requested);
  if (errorMismatch) return { id: errorMismatch, source: 'error-message' };

  const headerMismatch = input.headerIds.find((id) => id !== requested);
  if (headerMismatch) return { id: headerMismatch, source: 'response-header' };

  if (input.errorIds.length > 0) return { id: input.errorIds[0]!, source: 'error-message' };
  if (input.headerIds.length > 0) return { id: input.headerIds[0]!, source: 'response-header' };
  return { id: null, source: 'none' };
}

/* ------------------------------------------------------------------ */
/* Attribution                                                         */
/* ------------------------------------------------------------------ */

/** How a served-model name was learned, phrased for the summary line. */
const SOURCE_PHRASE: Record<NameSource, string> = {
  'response-model': 'which the endpoint reported on the response itself',
  'error-message': 'which the endpoint named in its own error',
  'response-header': 'which leaked through an upstream response header',
  ceiling: 'as narrowed by the measured output ceiling',
  'self-report': 'which is only what the model said about itself',
  none: 'though nothing named it',
};

/**
 * True when the "served" id is just the requested id read back.
 *
 * An echo is the single most common false positive in this whole tool: a proxy
 * that rewrites the response `model` to whatever you asked for looks identical
 * to an honest endpoint. It has to be treated as no evidence, not as a pass.
 */
function echoesRequest(servedModelId: string | null, requestedId: string): boolean {
  return !!servedModelId && bareId(servedModelId) === bareId(requestedId);
}

/** Same model line, differing only by a snapshot date or suffix. */
function sameLineage(a: string, b: string): boolean {
  const x = bareId(a);
  const y = bareId(b);
  return x.startsWith(y) || y.startsWith(x);
}

export interface AttributeOptions extends Pick<EngineOptions, 'config' | 'provider' | 'signal' | 'log'> {
  /** The id that was requested — the provider's claim, which is what we test. */
  model: string;
  /** Completed identity runs, mined for reported ids, headers and errors. */
  runs: readonly IdentityRun[];
  /** The model's own answers about itself, to be reported but never trusted. */
  selfReports?: readonly string[];
  /** True when every puzzle signal passed, false when any failed, null when none scored. */
  acedPuzzles?: boolean | null;
  /** Latest-dated fact the cutoff probe established the model knows (month number). */
  knownThrough?: number | null;
}

/**
 * Work out which model is really answering, and how sure we can be.
 *
 * Three extra requests: the output-ceiling probe (which usually makes the
 * endpoint state its own limit and resolved model id), the name-routing probe,
 * and one indirect vendor question. Everything else is mined from runs that have
 * already happened.
 */
export async function attribute(opts: AttributeOptions): Promise<Attribution> {
  const requested = opts.model;
  const advertised = advertisedOf(requested);
  const requestedVendorId = vendorOf(requested);
  const requestedFamily = familyOf(requested);

  const ceiling = await probeOutputCeiling(opts);
  opts.log?.('info', `Output ceiling: ${ceiling.detail}`);

  const resolution = await probeModelResolution(opts);
  opts.log?.(resolution.status === 'ignored' ? 'warning' : 'info', resolution.detail);

  const vendorText = await probeVendor(opts);

  // Ids the serving stack named, in descending order of how much they are worth.
  const reportedModels = opts.runs.map((r) => r.reportedModel);
  const errorIds = [
    ...new Set([
      ...ceiling.leakedIds,
      ...opts.runs.flatMap((r) => extractModelIds(r.error?.message ?? '')),
    ]),
  ];
  const headerIds = [...new Set(opts.runs.flatMap((r) => scanHeadersForModel(r.headers)))];

  const served = resolveServedModel({ requested, reportedModels, errorIds, headerIds });
  const echoed = echoesRequest(served.id, requested);
  const servedFamily = served.id ? familyOf(served.id) : null;
  const servedVendorId = served.id ? vendorOf(served.id) : null;

  // A mismatch only counts when both sides are known *and* the served id was not
  // simply echoed back. Snapshot ids of the same line are not substitutions.
  const familyMismatch =
    !echoed &&
    !!servedFamily &&
    !!requestedFamily &&
    servedFamily !== requestedFamily &&
    !(served.id && sameLineage(served.id, requested));
  const vendorMismatch = !echoed && !!servedVendorId && !!requestedVendorId && servedVendorId !== requestedVendorId;

  const vendorGuess = detectVendor([...(opts.selfReports ?? []), vendorText], requestedVendorId);

  const candidateFamilies =
    ceiling.ceiling !== null ? familiesWithCeiling(ceiling.ceiling, servedVendorId ?? requestedVendorId) : [];

  const rankedCandidates = rankFamilyCandidates({
    requestedId: requested,
    measuredCeiling: ceiling.ceiling,
    ceilingValidated: !ceiling.unvalidated,
    vendorHint: servedVendorId,
    claimedVendorId: vendorGuess.vendorId,
    acedPuzzles: opts.acedPuzzles ?? null,
    knownThrough: opts.knownThrough ?? null,
  });

  const attribution: Attribution = {
    servedModelId: echoed ? null : served.id,
    servedFamily: echoed ? null : servedFamily,
    servedVendor: echoed || !servedVendorId ? null : VENDOR_LABEL[servedVendorId],
    nameSource: echoed ? 'none' : served.source,
    requestedFamily,
    requestedVendor: requestedVendorId ? VENDOR_LABEL[requestedVendorId] : null,
    familyMismatch,
    vendorMismatch,
    nameHonored: resolution.status,
    probedFakeId: resolution.probedId,
    measuredCeiling: ceiling.ceiling,
    unvalidatedCeiling: ceiling.unvalidated,
    candidateFamilies,
    rankedCandidates,
    advertised,
    claimedVendor: vendorGuess.vendor,
    vendorMentions: vendorGuess.mentions,
    quotes: vendorGuess.quotes,
    summary: '',
  };
  attribution.summary = attributionSummary(attribution, requested);
  return attribution;
}

/**
 * The conclusion, in a sentence or two a buyer can act on.
 *
 * Written strongest-evidence-first and deliberately plain about its own limits:
 * where a name came from the serving stack it says so, and where the only thing
 * available is the model's own claim it says that too. It never converts absence
 * of evidence into a clean bill of health — "nothing contradicted the label" and
 * "the label is verified" are different sentences and the difference is the whole
 * value of the tool.
 */
export function attributionSummary(a: Attribution, requestedId: string): string {
  const parts: string[] = [];
  const claim = a.requestedFamily ?? requestedId;

  if (a.servedModelId && (a.vendorMismatch || a.familyMismatch)) {
    const what = a.servedVendor && a.vendorMismatch ? `${a.servedVendor}'s ${a.servedFamily ?? a.servedModelId}` : (a.servedFamily ?? a.servedModelId);
    parts.push(
      `Serving ${what} (${a.servedModelId}), ${SOURCE_PHRASE[a.nameSource]} — not the ${claim} you requested.`,
    );
  } else if (a.servedModelId) {
    parts.push(`Serving ${a.servedFamily ?? a.servedModelId} (${a.servedModelId}), ${SOURCE_PHRASE[a.nameSource]}.`);
  }

  if (a.nameHonored === 'ignored') {
    parts.push(
      'This endpoint is not routing on the model name at all — it answered a request for a model that does not exist, so every id it advertises may reach the same backend.',
    );
  }

  if (a.unvalidatedCeiling) {
    parts.push(
      `It also enforces no output limit, which ${a.advertised?.capsExact ? `${a.advertised.vendor} does` : 'a first-party API generally does'}, so this is a proxy in front of something else.`,
    );
  } else if (a.measuredCeiling !== null && a.advertised) {
    if (a.measuredCeiling === a.advertised.output) {
      parts.push(
        `Measured output ceiling is ${a.measuredCeiling.toLocaleString('en-US')} tokens, matching ${claim} as advertised.`,
      );
    } else if (a.advertised.capsExact) {
      parts.push(
        `Measured output ceiling is ${a.measuredCeiling.toLocaleString('en-US')} tokens, not the ${a.advertised.output.toLocaleString('en-US')} ${claim} allows${a.candidateFamilies.length ? ` — that cap belongs to ${a.candidateFamilies.join(', ')}` : ''}.`,
      );
    } else {
      parts.push(
        `Measured output ceiling is ${a.measuredCeiling.toLocaleString('en-US')} tokens; ${a.advertised.vendor} clamps rather than enforces this limit, so the difference from ${a.advertised.output.toLocaleString('en-US')} is not evidence by itself.`,
      );
    }
  }

  // What the model said. Only a contradiction is worth a sentence; agreement with
  // the advertised vendor is exactly what a spoofing system prompt produces.
  if (a.claimedVendor && a.requestedVendor && a.claimedVendor !== a.requestedVendor) {
    parts.push(`Asked directly, it named ${a.claimedVendor} rather than ${a.requestedVendor}.`);
  } else if (a.claimedVendor && a.requestedVendor && (a.vendorMismatch || a.nameHonored === 'ignored')) {
    parts.push(
      `It still calls itself ${a.claimedVendor}, which contradicts the findings above and is what a spoofing system prompt looks like.`,
    );
  }

  if (a.vendorMentions.length > 1) {
    parts.push(`Across runs it named more than one vendor (${a.vendorMentions.join(', ')}), which is itself a finding.`);
  }

  if (parts.length === 0) {
    return `Nothing contradicted ${claim}, but nothing confirmed it either: the endpoint never named the model it served, so a different tier from the same vendor would look identical to this.`;
  }
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Signals                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn attribution facts into scored signals.
 *
 * The weights carry the epistemics. `served-model-id` is hard because the serving
 * stack naming a different model is as close to proof as this tool gets.
 * `model-name-honored` is `context`: an endpoint that ignores model names is a
 * serious finding about the provider, but it is not evidence that this particular
 * response came from the wrong model. `output-ceiling` is only scored where the
 * vendor enforces its cap; elsewhere it is recorded and skipped.
 */
export function attributionSignals(a: Attribution, requestedId: string): IdentitySignal[] {
  const signals: IdentitySignal[] = [];
  const claim = a.requestedFamily ?? requestedId;

  signals.push({
    id: 'served-model-id',
    label: 'Model the endpoint served',
    weight: 'hard',
    status: a.servedModelId ? (a.vendorMismatch || a.familyMismatch ? 'fail' : 'pass') : 'skip',
    detail: a.servedModelId
      ? a.vendorMismatch || a.familyMismatch
        ? `Reported ${a.servedFamily ?? a.servedModelId} (${a.servedModelId}) for a request for ${claim}.`
        : `Reported ${a.servedModelId}, consistent with ${claim}.`
      : a.nameSource === 'none' && a.requestedFamily
        ? 'The endpoint echoed the id requested or named nothing, so it confirmed nothing.'
        : 'No source named the model actually served.',
    evidence: { servedModelId: a.servedModelId, nameSource: a.nameSource },
  });

  signals.push({
    id: 'model-name-honored',
    label: 'Endpoint routes on the model name',
    weight: 'context',
    status: a.nameHonored === 'ignored' ? 'fail' : a.nameHonored === 'honored' ? 'pass' : 'skip',
    detail:
      a.nameHonored === 'ignored'
        ? `Answered a request for "${a.probedFakeId}", which no vendor publishes. The model id you send is not selecting anything.`
        : a.nameHonored === 'honored'
          ? 'Rejected a nonexistent model id, so model names are validated.'
          : 'Could not establish whether model names are validated.',
    evidence: { probedFakeId: a.probedFakeId },
  });

  const ceilingScorable = !!a.advertised?.capsExact;
  signals.push({
    id: 'output-ceiling',
    label: 'Enforced output ceiling',
    weight: ceilingScorable ? 'hard' : 'context',
    status:
      a.unvalidatedCeiling && ceilingScorable
        ? 'fail'
        : a.measuredCeiling === null || !a.advertised
          ? 'skip'
          : !ceilingScorable
            ? 'skip'
            : a.measuredCeiling === a.advertised.output
              ? 'pass'
              : 'fail',
    detail: a.unvalidatedCeiling
      ? `Accepted an absurd max_tokens, so no output limit is enforced${ceilingScorable ? ` — ${a.advertised!.vendor} rejects values above the cap.` : '.'}`
      : a.measuredCeiling === null
        ? 'The ceiling could not be measured.'
        : !a.advertised
          ? `Accepts up to ${a.measuredCeiling.toLocaleString('en-US')} output tokens; the requested id is not in the registry, so there is nothing to compare it to.`
          : !ceilingScorable
            ? `Accepts up to ${a.measuredCeiling.toLocaleString('en-US')} output tokens. ${a.advertised.vendor} clamps this limit rather than enforcing it, so the number is reported but not scored.`
            : a.measuredCeiling === a.advertised.output
              ? `Accepts up to ${a.measuredCeiling.toLocaleString('en-US')} output tokens, exactly ${claim}'s published cap.`
              : `Accepts up to ${a.measuredCeiling.toLocaleString('en-US')} output tokens, but ${claim} allows ${a.advertised.output.toLocaleString('en-US')}${a.candidateFamilies.length ? ` — that cap belongs to ${a.candidateFamilies.join(', ')}` : ''}.`,
    evidence: { measuredCeiling: a.measuredCeiling, expected: a.advertised?.output ?? null },
  });

  return signals;
}

/**
 * Score the tokenizer count against the endpoint's own cohort.
 *
 * Skipped rather than failed whenever there is no baseline: an absolute token
 * count means nothing without a reference measured on the same endpoint.
 */
export function tokenizerSignal(outcome: TokenCountOutcome, baseline: number | null): IdentitySignal {
  const base: Pick<IdentitySignal, 'id' | 'label' | 'weight'> = {
    id: 'tokenizer-fingerprint',
    label: 'Tokenizer fingerprint',
    weight: 'hard',
  };
  if (!outcome.available || outcome.count === null) {
    return { ...base, status: 'skip', detail: outcome.detail, evidence: { count: outcome.count } };
  }
  if (baseline === null) {
    return {
      ...base,
      status: 'skip',
      detail: `${outcome.count} tokens. No sibling model was measured on this endpoint, so there is nothing to compare against.`,
      evidence: { count: outcome.count },
    };
  }
  const drift = Math.abs(outcome.count - baseline) / baseline;
  if (drift <= TOKENIZER_TOLERANCE) {
    return {
      ...base,
      status: 'pass',
      detail: `${outcome.count} tokens, matching the ${baseline}-token count from other models on this endpoint.`,
      evidence: { count: outcome.count, baseline },
    };
  }
  return {
    ...base,
    status: 'fail',
    detail: `${outcome.count} tokens against a cohort baseline of ${baseline} — a ${Math.round(drift * 100)}% difference, which means a different tokenizer and so a different model family.`,
    evidence: { count: outcome.count, baseline },
  };
}

/**
 * Compare what count_tokens says the request is against what the completion was
 * billed for, and read the gap as a hidden preamble.
 *
 * `count_tokens` tokenizes exactly the messages the client sends; the real
 * completion's billed input is what the backend actually processed. A reseller
 * gateway that prepends a persona ("you are Opus 5, never say otherwise") before
 * forwarding makes the completion bill more input tokens than count_tokens
 * reported for the same messages — the delta is the size of the injection.
 *
 * This is `context`, not `hard`, on purpose. The finding is about the provider's
 * serving stack, not about which model answered — a benign safety preamble has
 * the same shape as a spoofing one, and neither proves the underlying model is
 * wrong, so it must never fail a model's identity verdict on its own (the same
 * reasoning that keeps `model-name-honored` at `context`). Just as important, the
 * absence of a gap is not proof of a clean prompt: a gateway that pads its
 * count_tokens response by the same amount it injects hides the delta entirely,
 * so a pass here only means nothing leaked on this one arithmetic path.
 */
export function systemPromptSignal(input: {
  countAvailable: boolean;
  claimedInput: number | null; // count_tokens on the EXACT probe messages
  billedInput: number | null; // billedInputTokens() from the real completion of those same messages
}): IdentitySignal {
  const base: Pick<IdentitySignal, 'id' | 'label' | 'weight'> = {
    id: 'system-prompt-injection',
    label: 'Hidden system prompt',
    weight: 'context',
  };

  if (!input.countAvailable) {
    return {
      ...base,
      status: 'skip',
      detail:
        'count_tokens was unavailable, so the request size could not be compared against what the completion was billed — nothing to check for an injected preamble.',
      evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput },
    };
  }
  if (input.claimedInput === null) {
    return {
      ...base,
      status: 'skip',
      detail: 'count_tokens returned no token count for the probe, so there is nothing to compare against.',
      evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput },
    };
  }
  if (input.billedInput === null) {
    return {
      ...base,
      status: 'skip',
      detail: 'The completion reported no input usage, so there is nothing to compare against.',
      evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput },
    };
  }

  const delta = input.billedInput - input.claimedInput;

  if (delta > INJECTION_TOLERANCE) {
    return {
      ...base,
      status: 'fail',
      detail:
        `The completion billed ${input.billedInput} input tokens but count_tokens reported ${input.claimedInput} for the same messages — about ${delta} extra tokens were added upstream before the model saw the request. A hidden persona preamble injected by a gateway ("you are model X, never say otherwise") is exactly this shape. This is a finding about the provider, not proof of a different underlying model; and a gateway that padded count_tokens by the same amount would hide this gap, so a clean result elsewhere is not proof the prompt was left untouched.`,
      evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput, delta },
    };
  }

  if (delta < -INJECTION_TOLERANCE) {
    return {
      ...base,
      status: 'skip',
      detail:
        `count_tokens (${input.claimedInput}) exceeds the billed input (${input.billedInput}), which usually means server-side caching or a terser real tokenizer — neither indicates an injected preamble, so nothing is counted from this.`,
      evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput, delta },
    };
  }

  return {
    ...base,
    status: 'pass',
    detail:
      `Billed input (${input.billedInput}) matches count_tokens (${input.claimedInput}) within ${INJECTION_TOLERANCE} tokens, so no hidden preamble was detected on this path. This is not positive proof — an endpoint that padded its count_tokens response by the same amount it injected would still conceal the extra tokens.`,
    evidence: { claimedInput: input.claimedInput, billedInput: input.billedInput, delta },
  };
}

/**
 * Score the random-number distributional fingerprint against a baseline.
 *
 * Weight is `soft`: a divergent distribution is suggestive, never a verifiable
 * contradiction. Robustness comes from three guards that keep this from crying
 * wolf on noise: (1) it needs a real sample (>=30 parsed) before it scores at
 * all; (2) it compares against a *data-driven* threshold learned from how much
 * the cohort's own siblings scatter, not a fixed cutoff that a small sample
 * would trip; (3) even when it fails it is soft, so it moves the pass ratio but
 * can never alone flip a verdict to `mismatch`. Without a baseline or with too
 * few samples it is skipped, not counted.
 */
export function fingerprintSignal(fp: RandomNumberFingerprint): IdentitySignal {
  const base: Pick<IdentitySignal, 'id' | 'label' | 'weight'> = {
    id: 'random-number-fingerprint',
    label: 'Random-number distribution',
    weight: 'soft',
  };

  if (fp.baselineSource === 'none' || fp.divergence === null || fp.threshold === null) {
    return {
      ...base,
      status: 'skip',
      detail:
        `Collected ${fp.parsed} random-number samples, but no cohort baseline was available to compare against (this needs two or more models on the same endpoint), so the distribution is recorded but not scored.`,
      evidence: { attempted: fp.attempted, parsed: fp.parsed, divergence: fp.divergence },
    };
  }

  if (fp.parsed < 30) {
    return {
      ...base,
      status: 'skip',
      detail:
        `Only ${fp.parsed} of ${fp.attempted} samples parsed to a number — too few for a reliable distribution (needs 30+), so this is recorded but not scored rather than risk a false accusation on noise.`,
      evidence: { attempted: fp.attempted, parsed: fp.parsed, divergence: fp.divergence, threshold: fp.threshold },
    };
  }

  const div = fp.divergence;
  const thr = fp.threshold;
  if (div > thr) {
    return {
      ...base,
      status: 'fail',
      detail:
        `This model's "random" number distribution diverges from its cohort by more than the cohort's own siblings do (Jensen–Shannon ${div.toFixed(2)} > adaptive threshold ${thr.toFixed(2)}, from ${fp.parsed} samples). Numeric bias is baked into a model's weights and can't be spoofed by a system prompt, so this suggests a different underlying model. Soft signal — corroborating, not conclusive on its own.`,
      evidence: { divergence: div, threshold: thr, parsed: fp.parsed },
    };
  }

  return {
    ...base,
    status: 'pass',
    detail:
      `The random-number distribution sits within the cohort's own spread (Jensen–Shannon ${div.toFixed(2)} ≤ adaptive threshold ${thr.toFixed(2)}, from ${fp.parsed} samples), consistent with the same model family as its siblings on this endpoint.`,
    evidence: { divergence: div, threshold: thr, parsed: fp.parsed },
  };
}

interface PuzzleSpec {
  id: IdentitySignalId;
  label: string;
  item: number;
  check: (answer: string) => boolean;
  expected: string;
}

/**
 * Deterministic questions with one right answer each.
 *
 * Chosen because they are checkable without a reference model: a grader that has
 * to judge quality can be argued with, `17 * 24 = 408` cannot. They separate
 * capability tiers, not vendors — which is why they are only scored hard for
 * models whose real tier is expected to get them right.
 */
const PUZZLES: readonly PuzzleSpec[] = [
  { id: 'puzzle-arithmetic', label: 'Arithmetic (17 × 24)', item: 1, check: checksArithmetic, expected: '408' },
  { id: 'puzzle-strawberry', label: "Letter counting (r's in strawberry)", item: 2, check: checksStrawberry, expected: '3' },
  {
    id: 'puzzle-python-sum',
    label: 'Code generation (sum 1–100)',
    item: 3,
    check: checksPythonSum,
    expected: 'sum(range(1, 101))',
  },
  { id: 'puzzle-hard-arithmetic', label: 'Hard arithmetic (847 × 36)', item: 6, check: checksHardArithmetic, expected: '30492' },
  {
    id: 'puzzle-nonce-count',
    label: "Nonce letter counting (r's in retrospectrometer)",
    item: 7,
    check: checksNonceCount,
    expected: '4',
  },
];

/** Response-id shapes a vendor's own API is known to emit. */
const ID_PREFIX: Partial<Record<VendorId, { prefix: RegExp; example: string }>> = {
  anthropic: { prefix: /^msg_/, example: 'msg_…' },
};

export interface BuildSignalsInput {
  modelId: string;
  runs: readonly IdentityRun[];
  tokenizer: TokenCountOutcome | null;
  tokenizerBaseline: number | null;
}

/**
 * Build the behavioural signals from completed runs.
 *
 * Puzzle failures are downgraded to `soft` for small tiers and unknown ids. A
 * genuine Haiku really does miscount the r's in "strawberry", so failing one for
 * it would be a false accusation — and an unknown id gives us no idea what tier
 * to expect, which is the same situation.
 */
export function buildSignals(input: BuildSignalsInput): IdentitySignal[] {
  const { runs } = input;
  const texts = runs.map((r) => r.text);
  const ok = runs.filter((r) => !r.error && r.text.trim() !== '');
  const signals: IdentitySignal[] = [];
  const puzzleWeight: SignalWeight = isSmallModel(input.modelId) ? 'soft' : 'hard';
  const vendorId = vendorOf(input.modelId);
  const advertisedVendor = vendorId ? VENDOR_LABEL[vendorId] : null;

  for (const puzzle of PUZZLES) {
    const answers = ok.map((r) => extractAnswer(r.text, puzzle.item)).filter((a) => a !== '');
    const correct = answers.filter((a) => puzzle.check(a)).length;
    signals.push({
      id: puzzle.id,
      label: puzzle.label,
      weight: puzzleWeight,
      status: answers.length === 0 ? 'skip' : correct === answers.length ? 'pass' : correct > 0 ? 'partial' : 'fail',
      detail:
        answers.length === 0
          ? 'The model did not answer this item.'
          : `${correct}/${answers.length} runs correct (expected ${puzzle.expected}; got ${[...new Set(answers)].join(' · ').slice(0, 80)})${puzzleWeight === 'soft' ? '. Recorded but not scored against a small-tier model, which may genuinely miss this.' : '.'}`,
      evidence: { answers },
    });
  }

  const literals = ok.map((r) => extractAnswer(r.text, 4)).filter((a) => a !== '');
  const literalOk = literals.filter((a) => checksLiteral(a)).length;
  signals.push({
    id: 'instruction-following',
    label: 'Exact instruction following',
    weight: 'soft',
    status: literals.length === 0 ? 'skip' : literalOk === literals.length ? 'pass' : literalOk > 0 ? 'partial' : 'fail',
    detail:
      literals.length === 0
        ? 'The model did not answer this item.'
        : `${literalOk}/${literals.length} runs replied with exactly ORANGE.`,
    evidence: { literals },
  });

  // Item 8 is a second, stricter instruction-following check: the model must
  // count its own words, which trips models that merely pattern-match "reply
  // with the single word" prompts. Soft for the same reason item 4 is.
  const sevenWord = ok.map((r) => extractAnswer(r.text, 8)).filter((a) => a !== '');
  const sevenOk = sevenWord.filter((a) => checksSevenWords(a)).length;
  signals.push({
    id: 'format-constraint',
    label: 'Word-count constraint (seven words)',
    weight: 'soft',
    status: sevenWord.length === 0 ? 'skip' : sevenOk === sevenWord.length ? 'pass' : sevenOk > 0 ? 'partial' : 'fail',
    detail:
      sevenWord.length === 0
        ? 'The model did not answer this item.'
        : `${sevenOk}/${sevenWord.length} runs replied with exactly seven words.`,
    evidence: { sevenWord },
  });

  // Response-id shape. Only scored where the vendor's own API has a known shape;
  // a gateway that mints its own ids is not evidence of substitution either way.
  const shape = vendorId ? ID_PREFIX[vendorId] : undefined;
  const ids = runs.map((r) => r.messageId).filter((id): id is string => !!id);
  signals.push({
    id: 'response-id-shape',
    label: 'Response id shape',
    weight: 'soft',
    status: !shape || ids.length === 0 ? 'skip' : ids.every((id) => shape.prefix.test(id)) ? 'pass' : 'fail',
    detail: !shape
      ? `No published id shape for ${advertisedVendor ?? 'this vendor'}, so the id says nothing.`
      : ids.length === 0
        ? 'No response id was returned.'
        : ids.every((id) => shape.prefix.test(id))
          ? `Ids look like ${shape.example}, as ${advertisedVendor}'s API emits.`
          : `Ids (${ids[0]}) do not match ${advertisedVendor}'s ${shape.example} shape — common for a gateway that mints its own ids, so weighed lightly.`,
    evidence: { ids },
  });

  // Repeatability at temperature 0. A stable backend returns the same text; a
  // load balancer spreading requests across different models does not.
  const distinct = new Set(ok.map((r) => r.text.trim()));
  signals.push({
    id: 'consistency-check',
    label: 'Run-to-run consistency',
    weight: 'soft',
    status: ok.length < 2 ? 'skip' : distinct.size === 1 ? 'pass' : distinct.size < ok.length ? 'partial' : 'fail',
    detail:
      ok.length < 2
        ? 'Needs at least two successful runs.'
        : distinct.size === 1
          ? `All ${ok.length} runs returned identical text at temperature 0.`
          : `${distinct.size} different answers across ${ok.length} runs at temperature 0, which suggests requests are not all reaching the same backend.`,
    evidence: { distinct: distinct.size, runs: ok.length },
  });

  // What the model called itself. Scored only when it names a *different* vendor
  // than advertised: naming the expected one is the one thing a reseller's system
  // prompt would guarantee, so a pass there would be worthless.
  const claims = ok.map((r) => extractAnswer(r.text, 5)).filter((a) => a !== '');
  const claimed = readsClaimedVendor(claims.join('\n'));
  const contradicts = !!claimed.vendorId && !!vendorId && claimed.vendorId !== vendorId;
  signals.push({
    id: 'self-reported-vendor',
    label: 'Vendor it names for itself',
    weight: 'soft',
    status: claims.length === 0 ? 'skip' : contradicts ? 'fail' : 'skip',
    detail:
      claims.length === 0
        ? 'The model did not name itself.'
        : contradicts
          ? `Called itself ${claimed.vendor} while sold as ${advertisedVendor}: "${claims[0]}".`
          : `Said "${claims[0]}". A model naming its advertised vendor proves nothing — one line of system prompt produces that answer — so this is recorded, not scored.`,
    evidence: { claims, claimedVendor: claimed.vendor },
  });

  if (input.tokenizer) signals.push(tokenizerSignal(input.tokenizer, input.tokenizerBaseline));

  return signals;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run the whole identity probe for one model id.
 *
 * The question asked is always "is this the model the provider sold?", never "is
 * this a good model". Everything is done at temperature 0 with a fixed prompt so
 * the runs are comparable to each other and to other models on the same endpoint.
 */
export async function verifyModelIdentity(opts: VerifyOptions): Promise<IdentityReport> {
  const report = blankReport(opts.model);
  const runCount = Math.max(1, opts.runs ?? RUNS);
  const body: MessagesRequest = {
    model: opts.model,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    messages: [{ role: 'user', content: IDENTITY_PROBE }],
  };

  for (let i = 0; i < runCount; i += 1) {
    if (opts.signal?.aborted) break;
    const started = Date.now();
    const outcome = await streamMessages({
      config: opts.config,
      provider: opts.provider,
      signal: opts.signal,
      body,
    });
    const idEvent = outcome.events.find((e) => e.event === 'message_start');
    const message = (idEvent?.data as { message?: { id?: string; model?: string } } | undefined)?.message;

    report.runs.push({
      index: i,
      text: outcome.text,
      messageId: message?.id ?? null,
      reportedModel: message?.model ?? null,
      headers: outcome.headers,
      stopReason: outcome.stopReason,
      usage: outcome.usage,
      latencyMs: outcome.latencyMs || Date.now() - started,
      error: outcome.error,
    });
    opts.record?.({
      kind: 'model-test',
      label: `Identity run ${i + 1} — ${opts.model}`,
      model: opts.model,
      method: 'POST',
      path: '/v1/messages',
      status: outcome.status,
      ok: outcome.ok,
      latencyMs: outcome.latencyMs,
      ttftMs: outcome.ttftMs,
      usage: outcome.usage,
      responseHeaders: outcome.headers,
      error: outcome.error,
      streamed: true,
    });
  }

  const succeeded = report.runs.filter((r) => !r.error && r.text.trim() !== '');
  if (succeeded.length === 0) {
    report.verdict = 'error';
    report.error =
      report.runs[0]?.error ??
      classifyError({ status: null, message: 'The model returned no text, so nothing could be verified.' });
    return report;
  }

  let tokenizer: TokenCountOutcome | null = null;
  let probeCount: TokenCountOutcome | null = null;
  if (!opts.skipTokenizer) {
    tokenizer = await countTokens({
      config: opts.config,
      provider: opts.provider,
      signal: opts.signal,
      model: opts.model,
    });
    report.tokenizerCount = tokenizer.count;
    // Count the exact identity probe the runs sent, so its token count can be
    // compared against what the completion was billed for those same messages.
    probeCount = await countTokens({
      config: opts.config,
      provider: opts.provider,
      signal: opts.signal,
      model: opts.model,
      text: IDENTITY_PROBE,
    });
  }

  report.signals = buildSignals({
    modelId: opts.model,
    runs: report.runs,
    tokenizer,
    tokenizerBaseline: opts.tokenizerBaseline ?? null,
  });

  // Knowledge-cutoff probe: one extra request, graded against the advertised
  // family's registry window. Failure here is soft by design — cutoffs are
  // announced loosely — but a model knowing facts from after its family's data
  // was collected is a contradiction no system prompt can paper over. Skipped
  // entirely (no signal) only when the request itself fails; a transport error
  // says nothing about the model.
  const cutoff = await askCutoffQuestions({
    config: opts.config,
    provider: opts.provider,
    signal: opts.signal,
    model: opts.model,
    advertised: report.advertised,
    requestedId: opts.model,
  });
  if (cutoff.result) {
    report.cutoff = cutoff.result;
    report.signals.push(cutoffSignal(cutoff.result, report.advertised));
  }

  if (!opts.skipTokenizer && probeCount) {
    // Every succeeded run sent the same prompt, so billed input should be
    // identical; the median guards against a single anomalous run.
    const billedValues = succeeded
      .map((r) => billedInputTokens(r.usage))
      .filter((v): v is number => v !== null);
    const medianBilled = tokenizerBaseline(billedValues);
    report.signals.push(
      systemPromptSignal({
        countAvailable: probeCount.available,
        claimedInput: probeCount.count,
        billedInput: medianBilled,
      }),
    );
  }

  if (opts.attribute) {
    // Capability profile and knowledge horizon feed the ranked "closest
    // families" list, so they are computed before attribution.
    const puzzleSignals = report.signals.filter((s) => s.id.startsWith('puzzle-'));
    const acedPuzzles =
      puzzleSignals.length > 0 && puzzleSignals.every((s) => s.status === 'pass')
        ? true
        : puzzleSignals.some((s) => s.status === 'fail')
          ? false
          : null;
    const attribution = await attribute({
      config: opts.config,
      provider: opts.provider,
      signal: opts.signal,
      log: opts.log,
      model: opts.model,
      runs: report.runs,
      selfReports: succeeded.map((r) => r.text),
      acedPuzzles,
      knownThrough: report.cutoff?.knownThrough ?? null,
    });
    report.attribution = attribution;
    report.signals.push(...attributionSignals(attribution, opts.model));
  }

  if (opts.fingerprint || opts.fingerprintDistribution) {
    let distribution: number[];
    let attempted: number;
    let parsed: number;
    if (opts.fingerprintDistribution) {
      ({ distribution, attempted, parsed } = opts.fingerprintDistribution);
    } else {
      const n = Math.max(1, opts.fingerprintSamples ?? FINGERPRINT_SAMPLES);
      const sampled = await sampleRandomNumbers({
        config: opts.config,
        provider: opts.provider,
        signal: opts.signal,
        model: opts.model,
        n,
      });
      distribution = histogram(sampled.samples);
      attempted = sampled.attempted;
      parsed = sampled.parsed;
    }
    const baseline = opts.fingerprintBaseline ?? null;
    const hasBaseline =
      Array.isArray(baseline) &&
      baseline.length === distribution.length &&
      typeof opts.fingerprintThreshold === 'number';
    const fp: RandomNumberFingerprint = {
      distribution,
      attempted,
      parsed,
      divergence: hasBaseline ? jensenShannon(distribution, baseline!) : null,
      threshold: hasBaseline ? opts.fingerprintThreshold! : null,
      baselineSource: hasBaseline ? 'cohort-median' : 'none',
    };
    report.fingerprint = fp;
    report.signals.push(fingerprintSignal(fp));
  }

  const { verdict, confidence } = aggregateVerdict(report.signals, {
    vendor: report.attribution?.vendorMismatch,
    family: report.attribution?.familyMismatch,
  });
  report.verdict = verdict;
  report.confidence = confidence;
  report.at = Date.now();
  return report;
}










