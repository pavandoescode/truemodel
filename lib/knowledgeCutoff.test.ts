import { describe, expect, it } from 'vitest';
import { CUTOFF_QUESTIONS, buildCutoffProbe, cutoffSignal, gradeCutoff } from './knowledgeCutoff';
import { advertisedOf } from '@/lib/identity';

/** Every question answered correctly, through the latest (2025-05). */
const allCorrect = [
  'Everything Everywhere All at Once',
  'Liverpool',
  'Paris',
  'Donald Trump',
  'TikTok',
  'Leo XIV',
];

describe('buildCutoffProbe', () => {
  it('numbers every question and the answer template consistently', () => {
    const probe = buildCutoffProbe(CUTOFF_QUESTIONS);
    expect(probe).toContain('Answer all 6 items');
    for (let i = 1; i <= CUTOFF_QUESTIONS.length; i += 1) {
      expect(probe).toContain(`${i}: <answer>`);
    }
    expect(probe).toContain('Which city hosted the 2024 Summer Olympics?');
  });

  it('spans dates from 2023 to 2025 so the horizon can be bracketed', () => {
    expect(CUTOFF_QUESTIONS[0]!.dated).toBe('2023-03');
    expect(CUTOFF_QUESTIONS[CUTOFF_QUESTIONS.length - 1]!.dated).toBe('2025-05');
  });
});

describe('gradeCutoff', () => {
  const opus5 = 'claude-opus-5'; // window 2026-01…2026-04 — the battery sits well inside
  const gpt35 = 'gpt-3.5-turbo'; // window 2021-06…2021-12 — the battery sits after it
  const sonnet45 = 'claude-sonnet-4-5'; // window 2025-01…2025-04 — the battery straddles it

  it('knows-too-much: a 2021 model answering recent trivia fails', () => {
    const result = gradeCutoff(allCorrect, CUTOFF_QUESTIONS, advertisedOf(gpt35), gpt35);
    expect(result.lateCorrect).toBeGreaterThanOrEqual(2);
    const sig = cutoffSignal(result, advertisedOf(gpt35));
    expect(sig.status).toBe('fail');
    expect(sig.weight).toBe('soft');
    expect(sig.detail).toContain('cannot know events from after');
  });

  it('knows-too-little: a 2026 flagship missing 2023 trivia fails', () => {
    // Answers only the two latest items correctly; misses the four earliest.
    const patterns = ['', '', '', '', 'tiktok', 'Leo XIV'];
    const result = gradeCutoff(patterns, CUTOFF_QUESTIONS, advertisedOf(opus5), opus5);
    expect(result.earlyWrong).toBeGreaterThanOrEqual(2);
    const sig = cutoffSignal(result, advertisedOf(opus5));
    expect(sig.status).toBe('fail');
    expect(sig.detail).toContain('earlier generation');
  });

  it('passes a horizon consistent with the family window', () => {
    // Opus 5 (2026 window) answers everything: nothing contradicts.
    const result = gradeCutoff(allCorrect, CUTOFF_QUESTIONS, advertisedOf(opus5), opus5);
    expect(result.lateCorrect).toBe(0);
    expect(result.earlyWrong).toBe(0);
    expect(result.knownThrough).not.toBeNull();
    const sig = cutoffSignal(result, advertisedOf(opus5));
    expect(sig.status).toBe('pass');
    expect(sig.detail).toContain('consistent with');
  });

  it('a single late answer never fails the signal — one guess is not a pattern', () => {
    // GPT-3.5 gets exactly one late item right.
    const one = ['', '', 'Paris', '', '', ''];
    const result = gradeCutoff(one, CUTOFF_QUESTIONS, advertisedOf(gpt35), gpt35);
    expect(result.lateCorrect).toBe(1);
    expect(cutoffSignal(result, advertisedOf(gpt35)).status).not.toBe('fail');
  });

  it('a single early miss never fails the signal', () => {
    const one = ['', 'Liverpool', 'Paris', 'Trump', 'TikTok', 'Leo XIV'];
    const result = gradeCutoff(one, CUTOFF_QUESTIONS, advertisedOf(opus5), opus5);
    expect(result.earlyWrong).toBe(1);
    expect(cutoffSignal(result, advertisedOf(opus5)).status).toBe('pass');
  });

  it('skips entirely when the family has no cutoff window in the registry', () => {
    const unknown = 'someco/wizard-13b-v2';
    const result = gradeCutoff(allCorrect, CUTOFF_QUESTIONS, advertisedOf(unknown), unknown);
    expect(result.window).toBeNull();
    const sig = cutoffSignal(result, advertisedOf(unknown));
    expect(sig.status).toBe('skip');
    expect(sig.detail).toContain('no cutoff window');
  });

  it('skips when the model answered nothing at all', () => {
    const empty = CUTOFF_QUESTIONS.map(() => '');
    const result = gradeCutoff(empty, CUTOFF_QUESTIONS, advertisedOf(opus5), opus5);
    const sig = cutoffSignal(result, advertisedOf(opus5));
    expect(sig.status).toBe('skip');
    expect(result.knownThrough).toBeNull();
  });

  it('tracks the latest correct answer as the knowledge horizon', () => {
    // Correct through the 2024-11 item, missing the two 2025 items.
    const partial = ['Everything Everywhere All at Once', 'Liverpool', 'Paris', 'Donald Trump', '', ''];
    const result = gradeCutoff(partial, CUTOFF_QUESTIONS, advertisedOf(sonnet45), sonnet45);
    expect(result.knownThrough).toBe(2024 * 12 + 10); // 2024-11 as an absolute month
    expect(result.correct).toBe(4);
  });

  it('accepts phrased answers, not just bare facts', () => {
    const phrased = [
      'The film was Everything Everywhere All at Once',
      'It was hosted in Liverpool',
      'The Games were held in Paris, France',
      'Donald Trump won',
      'TikTok did',
      'Leo XIV (Robert Prevost)',
    ];
    const result = gradeCutoff(phrased, CUTOFF_QUESTIONS, advertisedOf(opus5), opus5);
    expect(result.correct).toBe(6);
    expect(phrased).toHaveLength(CUTOFF_QUESTIONS.length);
  });
});
