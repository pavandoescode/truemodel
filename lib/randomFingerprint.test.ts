import { describe, it, expect } from 'vitest';
import {
  parseSingleInt,
  histogram,
  jensenShannon,
  medianDistribution,
  cohortDivergenceThreshold,
  RANDOM_MIN,
  RANDOM_MAX,
} from './randomFingerprint';

describe('parseSingleInt', () => {
  it('parses a bare integer', () => {
    expect(parseSingleInt('42')).toBe(42);
  });
  it('parses a trailing-dot integer', () => {
    expect(parseSingleInt('42.')).toBe(42);
  });
  it('parses an integer embedded in words', () => {
    expect(parseSingleInt('The number is 7!')).toBe(7);
  });
  it('accepts the range boundaries', () => {
    expect(parseSingleInt('1')).toBe(RANDOM_MIN);
    expect(parseSingleInt('100')).toBe(RANDOM_MAX);
  });
  it('rejects out-of-range and picks the first in-range integer', () => {
    // 200 is out of range, 55 is in range.
    expect(parseSingleInt('200 or maybe 55')).toBe(55);
  });
  it('returns null when no in-range integer exists', () => {
    expect(parseSingleInt('two hundred')).toBeNull();
    expect(parseSingleInt('101')).toBeNull();
  });
});

describe('histogram', () => {
  it('normalizes to sum 1', () => {
    const h = histogram([1, 1, 2, 100]);
    const sum = h.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
  it('places mass in the correct bins', () => {
    const h = histogram([1, 1, 100]);
    expect(h[0]).toBeCloseTo(2 / 3, 10); // value 1 → bin 0
    expect(h[99]).toBeCloseTo(1 / 3, 10); // value 100 → bin 99
  });
  it('returns a uniform distribution for empty input', () => {
    const h = histogram([]);
    expect(h.every((p) => Math.abs(p - 1 / h.length) < 1e-12)).toBe(true);
  });
  it('ignores out-of-range samples', () => {
    const h = histogram([1, 999, -5]);
    expect(h[0]).toBeCloseTo(1, 10);
  });
});

describe('jensenShannon', () => {
  it('is 0 for identical distributions', () => {
    const p = histogram([1, 2, 3, 4, 5]);
    expect(jensenShannon(p, p)).toBeCloseTo(0, 10);
  });
  it('is 1 for disjoint supports', () => {
    const p = histogram([1]);
    const q = histogram([100]);
    expect(jensenShannon(p, q)).toBeCloseTo(1, 10);
  });
  it('is symmetric', () => {
    const p = histogram([1, 1, 2, 50]);
    const q = histogram([2, 50, 50, 99]);
    expect(jensenShannon(p, q)).toBeCloseTo(jensenShannon(q, p), 12);
  });
  it('stays within [0,1]', () => {
    const p = histogram([10, 20, 30]);
    const q = histogram([40, 50, 60, 70]);
    const jsd = jensenShannon(p, q);
    expect(jsd).toBeGreaterThanOrEqual(0);
    expect(jsd).toBeLessThanOrEqual(1);
  });
  it('throws on length mismatch', () => {
    expect(() => jensenShannon([0.5, 0.5], [1])).toThrow();
  });
});

describe('medianDistribution', () => {
  it('returns null for no valid distributions', () => {
    expect(medianDistribution([])).toBeNull();
    expect(medianDistribution([[1, 2, 3]])).toBeNull(); // wrong length
  });
  it('sums to 1', () => {
    const a = histogram([1, 2, 3]);
    const b = histogram([2, 3, 4]);
    const m = medianDistribution([a, b])!;
    expect(m.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 10);
  });
  it('equals the input when all distributions are identical', () => {
    const a = histogram([10, 20, 30, 40]);
    const m = medianDistribution([a, a, a])!;
    for (let i = 0; i < a.length; i += 1) expect(m[i]).toBeCloseTo(a[i]!, 10);
  });
});

describe('cohortDivergenceThreshold', () => {
  it('returns null without a cohort (fewer than 2 distributions)', () => {
    const a = histogram([1, 2, 3]);
    expect(cohortDivergenceThreshold([a], a)).toBeNull();
    expect(cohortDivergenceThreshold([], a)).toBeNull();
  });
  it('never drops below the 0.15 floor for a tight cohort', () => {
    const a = histogram([1, 2, 3, 4, 5]);
    // Identical members => zero spread => threshold pinned to the floor.
    const thr = cohortDivergenceThreshold([a, a, a], a)!;
    expect(thr).toBeCloseTo(0.15, 10);
  });
  it('widens the threshold when the cohort itself scatters', () => {
    const base = medianDistribution([histogram([1, 50, 100]), histogram([2, 40, 90])])!;
    const spread = [histogram([1, 50, 100]), histogram([2, 40, 90])];
    const thr = cohortDivergenceThreshold(spread, base)!;
    expect(thr).toBeGreaterThanOrEqual(0.15);
  });
});
