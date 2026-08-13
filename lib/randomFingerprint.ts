/**
 * Random-number distributional fingerprint.
 *
 * LLMs are not uniform random generators: asked to "pick a number between 1 and
 * 100" they show stable, model-specific biases (over-picking 42/47/73, avoiding
 * round numbers and boundaries). Those biases live in the weights, so — unlike a
 * "what model are you?" answer — they cannot be spoofed by a gateway's system
 * prompt. Collecting many single-token samples and comparing the histogram
 * against a baseline via Jensen–Shannon divergence distinguishes model lineages
 * even through opaque APIs.
 *
 * Reference: LLMmap; "One Token Is Enough" (2026).
 *
 * Everything here except `sampleRandomNumbers` is a pure function so the maths
 * can be unit-tested without touching the network.
 */

import { streamMessages } from '@/lib/apiClient';
import type { EngineOptions, MessagesRequest } from '@/lib/types';

/** The 1–100 range we sample over. */
export const RANDOM_MIN = 1;
export const RANDOM_MAX = 100;
const BINS = RANDOM_MAX - RANDOM_MIN + 1;

/**
 * Deliberately terse so the model emits just the integer. Temperature is set
 * high at call time — we *want* the sampling distribution, not the mode.
 */
export const RANDOM_NUMBER_PROBE =
  'Pick a random integer between 1 and 100 inclusive. Reply with only the number — no words, no punctuation.';

/**
 * Pull a single integer in [1,100] out of a reply. Models sometimes wrap it
 * ("42.", "The number is 7", "**73**"), so take the first integer that lands in
 * range. Returns null when nothing usable is found.
 */
export function parseSingleInt(text: string): number | null {
  const matches = text.match(/-?\d+/g);
  if (!matches) return null;
  for (const m of matches) {
    const n = Number.parseInt(m, 10);
    if (Number.isFinite(n) && n >= RANDOM_MIN && n <= RANDOM_MAX) return n;
  }
  return null;
}

/**
 * Normalized histogram over [1,100] as a 100-length probability vector.
 * Empty input yields a uniform distribution so downstream divergence is defined.
 */
export function histogram(samples: readonly number[]): number[] {
  const counts = new Array<number>(BINS).fill(0);
  let total = 0;
  for (const s of samples) {
    if (s >= RANDOM_MIN && s <= RANDOM_MAX) {
      counts[s - RANDOM_MIN] += 1;
      total += 1;
    }
  }
  if (total === 0) return counts.map(() => 1 / BINS);
  return counts.map((c) => c / total);
}

/**
 * Element-wise median across several distributions, renormalized to sum 1.
 *
 * This is the cohort baseline: one vendor generation shares numeric biases, so
 * the median distribution across an endpoint's models is what a genuine sibling
 * should look like. A model that diverges from it is being served differently
 * from the rest of the lineup, whatever the provider calls it.
 */
export function medianDistribution(dists: readonly number[][]): number[] | null {
  const valid = dists.filter((d) => d.length === BINS);
  if (valid.length === 0) return null;
  const out = new Array<number>(BINS).fill(0);
  for (let bin = 0; bin < BINS; bin += 1) {
    const col = valid.map((d) => d[bin]!).sort((a, b) => a - b);
    const mid = Math.floor(col.length / 2);
    out[bin] = col.length % 2 === 0 ? (col[mid - 1]! + col[mid]!) / 2 : col[mid]!;
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((v) => v / sum) : out.map(() => 1 / BINS);
}

/**
 * A data-driven "how far is too far" threshold for divergence from the baseline.
 *
 * A fixed cutoff is unreliable: with a few dozen samples, genuine siblings drawn
 * from the *same* model still diverge from their cohort median by a noticeable
 * amount (Monte-Carlo: ~0.37 at 40 samples), which a fixed 0.35 would flag as a
 * mismatch. Instead we measure how much the cohort's own members diverge from
 * their median and require a suspect to exceed that spread by a safety margin.
 * This adapts to sample count automatically — more samples tighten the cohort,
 * which tightens the threshold — so the check keeps its false-positive rate low
 * whatever `n` the caller chose.
 *
 * Returns null when there is no cohort (fewer than 2 distributions) to learn a
 * spread from, in which case the fingerprint should be left unscored.
 */
export function cohortDivergenceThreshold(
  dists: readonly number[][],
  baseline: readonly number[],
): number | null {
  const valid = dists.filter((d) => d.length === baseline.length);
  if (valid.length < 2) return null;
  const within = valid.map((d) => jensenShannon(d, baseline));
  const withinMax = Math.max(...within);
  // 1.8x the widest genuine sibling, with a floor so a suspiciously *tight*
  // cohort (e.g. every model is secretly one backend) can't drive the bar to 0.
  return Math.max(0.15, withinMax * 1.8);
}

/** Kullback–Leibler divergence D(p‖q), base 2. Assumes p, q are same-length distributions. */
function kl(p: readonly number[], q: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i]! > 0 && q[i]! > 0) {
      sum += p[i]! * Math.log2(p[i]! / q[i]!);
    }
  }
  return sum;
}

/**
 * Jensen–Shannon divergence, base 2, in [0,1]. Symmetric and always finite
 * (unlike raw KL). 0 = identical distributions, 1 = disjoint supports.
 */
export function jensenShannon(p: readonly number[], q: readonly number[]): number {
  if (p.length !== q.length) throw new Error('distributions must be the same length');
  const m = p.map((_, i) => (p[i]! + q[i]!) / 2);
  const jsd = 0.5 * kl(p, m) + 0.5 * kl(q, m);
  // Numerical noise can nudge this a hair outside [0,1]; clamp.
  return Math.min(1, Math.max(0, jsd));
}

export interface SampleResult {
  /** Parsed integers, one per successful run. */
  samples: number[];
  /** How many requests were attempted. */
  attempted: number;
  /** How many produced a usable integer. */
  parsed: number;
}

/**
 * Fire `n` single-token requests at temperature 1 and collect the integers.
 * Respects the abort signal between requests. max_tokens is tiny because we
 * only need the number.
 */
export async function sampleRandomNumbers(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string; n: number },
): Promise<SampleResult> {
  const samples: number[] = [];
  let attempted = 0;
  const body: MessagesRequest = {
    model: opts.model,
    max_tokens: 8,
    temperature: 1,
    messages: [{ role: 'user', content: RANDOM_NUMBER_PROBE }],
  };

  for (let i = 0; i < opts.n; i += 1) {
    if (opts.signal?.aborted) break;
    attempted += 1;
    const outcome = await streamMessages({
      config: opts.config,
      provider: opts.provider,
      signal: opts.signal,
      body,
    });
    if (outcome.error) continue;
    const n = parseSingleInt(outcome.text);
    if (n !== null) samples.push(n);
  }

  return { samples, attempted, parsed: samples.length };
}
