/**
 * Stylometry fingerprint, measured on text the identity runs already collected.
 *
 * Model families have stable writing habits — sentence length, how much
 * markdown they reach for, dash and ellipsis rates — that differ between
 * vendors and generations. A model serving behind a substituted label still
 * writes like itself, so comparing each model's style vector against the
 * cohort median on the same endpoint is a free (zero extra request) sibling
 * check in the same spirit as the tokenizer and random-number fingerprints.
 *
 * Honest limits, by design:
 * - The identity probe asks for a rigid numbered format, which mutes style
 *   differences, so the signal is weak-but-cheap and stays `soft`.
 * - Short answers carry almost no style. Below a minimum length the vector is
 *   refused rather than scored on noise.
 * - The threshold is learned from the cohort's own spread, exactly like the
 *   random-number fingerprint: no cohort (fewer than two models), no score.
 */

import type { IdentitySignal, StyleFingerprint } from '@/lib/types';

/** Minimum characters of run text before a style vector means anything. */
export const MIN_STYLE_CHARS = 160;

/** Names of the features, in vector order — for evidence and tests. */
export const STYLE_FEATURE_NAMES: readonly string[] = [
  'avg sentence length',
  'bold density',
  'bullet density',
  'header density',
  'em-dash rate',
  'ellipsis rate',
  'exclamation rate',
  'question rate',
  'code-fence rate',
  'avg word length',
];

/**
 * Per-feature floors for relative deviation: below these a difference is
 * counting zeros against zeros. Chosen per feature's natural scale (rates are
 * small numbers by construction).
 */
const FEATURE_FLOORS: readonly number[] = [3, 0.5, 0.2, 0.05, 0.15, 0.05, 0.05, 0.05, 0.1, 3.2];

/** Cap on any single feature's relative deviation so one quirk can't dominate. */
const FEATURE_CAP = 3;

/**
 * Extract the style feature vector from a model's run text.
 *
 * Returns null below the minimum length — a two-line answer says more about
 * the prompt than about the model. All features are rates or averages, so
 * they are comparable across texts of different lengths.
 */
export function styleFeatures(text: string): number[] | null {
  const t = text ?? '';
  if (t.trim().length < MIN_STYLE_CHARS) return null;

  const words = t.match(/[\p{L}\p{N}']+/gu) ?? [];
  const wordCount = words.length || 1;
  const sentences = t.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  const lines = t.split('\n').filter((l) => l.trim().length > 0);
  const lineCount = lines.length || 1;
  const perThousand = (n: number) => (n * 1000) / Math.max(t.length, 1);

  const bold = (t.match(/\*\*/g) ?? []).length / 2;
  const bullets = lines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)).length;
  const headers = lines.filter((l) => /^\s*#{1,6}\s/.test(l)).length;
  const emDash = (t.match(/—/g) ?? []).length;
  const ellipsis = (t.match(/…|\.\.\./g) ?? []).length;
  const exclam = (t.match(/!/g) ?? []).length;
  const question = (t.match(/\?/g) ?? []).length;
  const fences = (t.match(/```/g) ?? []).length / 2;
  const letters = words.join('').length;

  return [
    clamp(wordCount / Math.max(sentences.length, 1), 1, 80),
    (bold * 100) / wordCount,
    (bullets * 100) / lineCount,
    (headers * 100) / lineCount,
    perThousand(emDash),
    perThousand(ellipsis),
    perThousand(exclam),
    perThousand(question),
    perThousand(fences),
    clamp(letters / wordCount, 1, 20),
  ];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Element-wise median across the cohort's vectors.
 * Vectors shorter or longer than the first valid one are rejected (a mangled
 * extraction must not skew the median). Null when nothing usable was measured.
 */
export function medianStyleVector(vectors: readonly (number[] | null)[]): number[] | null {
  const arrays = vectors.filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (arrays.length === 0) return null;
  const valid = arrays.filter((v) => v.length === arrays[0]!.length);
  if (valid.length === 0) return null;
  const out = new Array<number>(valid[0]!.length);
  for (let i = 0; i < out.length; i += 1) {
    const col = valid.map((v) => v[i]!).sort((a, b) => a - b);
    const mid = Math.floor(col.length / 2);
    out[i] = col.length % 2 === 0 ? (col[mid - 1]! + col[mid]!) / 2 : col[mid]!;
  }
  return out;
}

/**
 * Mean relative deviation between two vectors, [0, FEATURE_CAP].
 *
 * Each feature contributes |a−b| relative to the larger of the baseline and
 * that feature's floor, capped so a single runaway feature (a model that
 * suddenly loves headers) cannot dominate the total.
 */
export function styleDivergence(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error('style vectors must be the same length');
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const denom = Math.max(Math.abs(b[i]!), FEATURE_FLOORS[i] ?? 1);
    sum += Math.min(FEATURE_CAP, Math.abs(a[i]! - b[i]!) / denom);
  }
  return sum / a.length;
}

/**
 * Cohort-learned "how different is too different" threshold, in the same
 * spirit as `cohortDivergenceThreshold` for the random-number fingerprint:
 * measure how far the cohort's own members sit from their median and require a
 * suspect to exceed that spread by a safety factor. Null below two models —
 * with a single style vector there is no spread to learn from.
 */
export function cohortStyleThreshold(vectors: readonly number[][], baseline: readonly number[]): number | null {
  if (vectors.length < 2) return null;
  const within = vectors.map((v) => styleDivergence(v, baseline));
  const widest = Math.max(...within);
  return Math.max(0.35, widest * 2);
}

/** Score one model's style divergence against the cohort. */
export function styleSignal(fp: StyleFingerprint): IdentitySignal {
  const base: Pick<IdentitySignal, 'id' | 'label' | 'weight'> = {
    id: 'style-fingerprint',
    label: 'Writing style vs siblings',
    weight: 'soft',
  };

  if (fp.baselineSource === 'none' || fp.divergence === null || fp.threshold === null) {
    return {
      ...base,
      status: 'skip',
      detail: `Writing style measured over ${fp.chars} characters, but no sibling model on this endpoint could be compared against (this needs two or more models with long-enough answers), so the style vector is recorded but not scored.`,
      evidence: { chars: fp.chars },
    };
  }

  if (fp.divergence > fp.threshold) {
    return {
      ...base,
      status: 'fail',
      detail: `Writing style diverges from the endpoint's other models (mean relative deviation ${fp.divergence.toFixed(2)} > cohort-adaptive threshold ${fp.threshold.toFixed(2)}, over ${fp.chars} characters). Families have stable habits — sentence length, markdown density, punctuation rates — and a substituted backend still writes like itself. The probe's rigid format mutes differences, so this is corroborating evidence only, never decisive on its own.`,
      evidence: { divergence: fp.divergence, threshold: fp.threshold, chars: fp.chars },
    };
  }

  return {
    ...base,
    status: 'pass',
    detail: `Writing style sits within its cohort's own spread (deviation ${fp.divergence.toFixed(2)} ≤ threshold ${fp.threshold.toFixed(2)}), consistent with the same family as the endpoint's other models. Weak evidence by construction — the probe's fixed format leaves little room for individual style.`,
    evidence: { divergence: fp.divergence, threshold: fp.threshold, chars: fp.chars },
  };
}
