import { describe, expect, it } from 'vitest';
import {
  MIN_STYLE_CHARS,
  STYLE_FEATURE_NAMES,
  cohortStyleThreshold,
  medianStyleVector,
  styleDivergence,
  styleFeatures,
  styleSignal,
} from './stylometry';

/** A plain, mid-length probe-style answer. */
const PLAIN = `1: 408
2: 3
3: sum(range(1, 101))
4: ORANGE
5: Claude Opus 5
6: 30492
7: 4
8: This reply contains exactly seven short words
The arithmetic items were computed directly, the letter counts were taken one character at a time, and the expression sums the integers from one through one hundred inclusive.`;

/** Same facts, but written by a model that reaches for markdown and dashes. */
const DECORATED = `**1:** The answer is **408**.
**2:** There are three r's — I counted them.
**3:** \`sum(range(1, 101))\` is the expression.
**4:** ORANGE!
**5:** I am Claude Opus 5…
**6:** 847 × 36 equals **30,492** — here is why: 847 × 30 = 25,410, plus 847 × 6 = 5,082.
**7:** Four. The word retrospectrometer has four r's.
**8:** This reply contains exactly seven words — counted.`;

describe('styleFeatures', () => {
  it('refuses text below the minimum length rather than score noise', () => {
    expect(styleFeatures('1: 408')).toBeNull();
    expect(styleFeatures('x'.repeat(MIN_STYLE_CHARS - 1))).toBeNull();
    expect(styleFeatures('x'.repeat(MIN_STYLE_CHARS))).not.toBeNull();
  });

  it('returns the feature vector in the documented order', () => {
    const v = styleFeatures(PLAIN);
    expect(v).not.toBeNull();
    expect(v).toHaveLength(STYLE_FEATURE_NAMES.length);
  });

  it('is deterministic for identical input', () => {
    expect(styleFeatures(PLAIN)).toEqual(styleFeatures(PLAIN));
  });

  it('measures decoration: the decorated text has more bold and em-dashes', () => {
    const plain = styleFeatures(PLAIN)!;
    const decorated = styleFeatures(DECORATED)!;
    const bold = STYLE_FEATURE_NAMES.indexOf('bold density');
    const dash = STYLE_FEATURE_NAMES.indexOf('em-dash rate');
    expect(decorated[bold]!).toBeGreaterThan(plain[bold]!);
    expect(decorated[dash]!).toBeGreaterThan(plain[dash]!);
  });
});

describe('medianStyleVector', () => {
  it('takes the element-wise median and ignores nulls', () => {
    const a = [1, 2, 3, 4];
    const b = [5, 6, 7, 8];
    const c = [9, 10, 11, 12];
    expect(medianStyleVector([a, null, b, c])).toEqual([5, 6, 7, 8]);
  });

  it('returns null when nothing was measured', () => {
    expect(medianStyleVector([])).toBeNull();
    expect(medianStyleVector([null, null])).toBeNull();
  });
});

describe('styleDivergence', () => {
  it('is zero for identical vectors', () => {
    const v = styleFeatures(PLAIN)!;
    expect(styleDivergence(v, v)).toBe(0);
  });

  it('grows when styles differ', () => {
    const plain = styleFeatures(PLAIN)!;
    const decorated = styleFeatures(DECORATED)!;
    expect(styleDivergence(decorated, plain)).toBeGreaterThan(0);
  });

  it('caps a single runaway feature so one quirk cannot dominate', () => {
    const a = [10, 30, 0, 0, 0, 0, 0, 0, 0, 10];
    const b = [10, 5, 0, 0, 0, 0, 0, 0, 0, 10];
    // Feature 1: |30−5|/max(5, floor) = 5 → clamped at 3; every other feature
    // contributes 0, so the mean is 3/10 = 0.3, not a blow-up.
    expect(styleDivergence(a, b)).toBeCloseTo(0.3, 5);
  });
});

describe('cohortStyleThreshold', () => {
  it('learns from the cohort spread and floors it', () => {
    const a = styleFeatures(PLAIN)!;
    const near = a.slice();
    near[0]! += 1;
    const threshold = cohortStyleThreshold([a, near], a);
    expect(threshold).not.toBeNull();
    expect(threshold!).toBeGreaterThanOrEqual(0.35);
    // 2x the widest sibling divergence, subject to the floor.
    expect(threshold!).toBeGreaterThanOrEqual(styleDivergence(near, a) * 2);
  });

  it('refuses to learn from fewer than two vectors', () => {
    const a = styleFeatures(PLAIN)!;
    expect(cohortStyleThreshold([a], a)).toBeNull();
  });
});

describe('styleSignal', () => {
  it('skips without a cohort baseline', () => {
    const sig = styleSignal({ divergence: null, threshold: null, chars: 400, baselineSource: 'none' });
    expect(sig.id).toBe('style-fingerprint');
    expect(sig.weight).toBe('soft');
    expect(sig.status).toBe('skip');
    expect(sig.detail).toContain('no sibling model');
  });

  it('fails when divergence exceeds the learned threshold', () => {
    const sig = styleSignal({ divergence: 1.4, threshold: 0.6, chars: 900, baselineSource: 'cohort-median' });
    expect(sig.status).toBe('fail');
    expect(sig.weight).toBe('soft');
    expect(sig.detail).toContain('corroborating evidence'); // stays honest about its weight
  });

  it('passes within the cohort spread and says the evidence is weak', () => {
    const sig = styleSignal({ divergence: 0.2, threshold: 0.6, chars: 900, baselineSource: 'cohort-median' });
    expect(sig.status).toBe('pass');
    expect(sig.detail).toContain('Weak evidence');
  });
});
