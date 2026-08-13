import { describe, expect, it } from 'vitest';
import {
  advertisedOf,
  aggregateVerdict,
  billedInputTokens,
  buildSignals,
  checksArithmetic,
  checksLiteral,
  checksPythonSum,
  checksStrawberry,
  extractAnswer,
  readsClaimedVendor,
  systemPromptSignal,
  tokenizerBaseline,
  tokenizerSignal,
} from '@/lib/identity';
import type { IdentityRun, IdentitySignal, IdentitySignalId, SignalWeight, Usage } from '@/lib/types';

function signal(id: IdentitySignalId, status: IdentitySignal['status'], weight: SignalWeight = 'hard'): IdentitySignal {
  return { id, label: id, status, weight, detail: '' };
}

/** A run that answered every item correctly, for signal-building tests. */
function goodRun(index: number, name = 'Claude Opus 5', overrides: Partial<IdentityRun> = {}): IdentityRun {
  return {
    index,
    text: `1: 408\n2: 3\n3: sum(range(1, 101))\n4: ORANGE\n5: ${name}`,
    messageId: 'msg_01ABC',
    reportedModel: null,
    headers: null,
    stopReason: 'end_turn',
    usage: null,
    latencyMs: 100,
    error: null,
    ...overrides,
  };
}

describe('extractAnswer', () => {
  const reply = `1: 408
2: 3
3: sum(range(1, 101))
4: ORANGE
5: Claude Sonnet 4.5`;

  it('pulls each numbered line', () => {
    expect(extractAnswer(reply, 1)).toBe('408');
    expect(extractAnswer(reply, 2)).toBe('3');
    expect(extractAnswer(reply, 3)).toBe('sum(range(1, 101))');
    expect(extractAnswer(reply, 4)).toBe('ORANGE');
    expect(extractAnswer(reply, 5)).toBe('Claude Sonnet 4.5');
  });

  it('tolerates markdown bold and dot separators', () => {
    expect(extractAnswer('**1.** 408', 1)).toBe('408');
    expect(extractAnswer('1) 408', 1)).toBe('408');
  });

  it('returns an empty string when the item is missing', () => {
    expect(extractAnswer('nothing here', 3)).toBe('');
  });
});

describe('answer checkers', () => {
  it('accepts only 408 for the arithmetic item', () => {
    expect(checksArithmetic('408')).toBe(true);
    expect(checksArithmetic('The answer is 408.')).toBe(true);
    expect(checksArithmetic('407')).toBe(false);
    expect(checksArithmetic('4080')).toBe(false);
    expect(checksArithmetic('')).toBe(false);
  });

  it('accepts three for the strawberry count and rejects two', () => {
    expect(checksStrawberry('3')).toBe(true);
    expect(checksStrawberry('three')).toBe(true);
    expect(checksStrawberry('There are 3 rs')).toBe(true);
    expect(checksStrawberry('2')).toBe(false);
    expect(checksStrawberry('two')).toBe(false);
  });

  it('accepts correct python sum forms', () => {
    expect(checksPythonSum('sum(range(1, 101))')).toBe(true);
    expect(checksPythonSum('sum(range(101))')).toBe(true);
    expect(checksPythonSum('5050')).toBe(true);
    expect(checksPythonSum('sum(range(1, 100))')).toBe(false);
  });

  it('requires exactly ORANGE for the literal item', () => {
    expect(checksLiteral('ORANGE')).toBe(true);
    expect(checksLiteral('orange')).toBe(true);
    expect(checksLiteral('**ORANGE**')).toBe(true);
    expect(checksLiteral('The word is ORANGE')).toBe(false);
  });

  it('reads the vendor a model names for itself, whoever it is', () => {
    expect(readsClaimedVendor('GPT-4o').vendorId).toBe('openai');
    expect(readsClaimedVendor('Claude Sonnet 4.5').vendorId).toBe('anthropic');
    expect(readsClaimedVendor('Qwen 3 235B').vendorId).toBe('alibaba');
    expect(readsClaimedVendor('an AI assistant').vendorId).toBeNull();
  });
});

describe('advertisedOf', () => {
  it('describes what a known id claims to be', () => {
    expect(advertisedOf('claude-opus-5')).toEqual({
      vendor: 'Anthropic',
      family: 'Opus 5',
      output: 128_000,
      context: 1_000_000,
      capsExact: true,
    });
  });

  it('marks a clamping vendor as not exactly capped', () => {
    expect(advertisedOf('gemini-3-pro')?.capsExact).toBe(false);
  });

  it('returns null for an unrecognised id', () => {
    expect(advertisedOf('wizard-13b-uncensored')).toBeNull();
  });
});

describe('tokenizerBaseline', () => {
  it('takes the median of an odd-sized cohort', () => {
    expect(tokenizerBaseline([150, 148, 149])).toBe(149);
  });

  it('averages the middle pair of an even-sized cohort', () => {
    expect(tokenizerBaseline([148, 150])).toBe(149);
  });

  it('is unmoved by a single outlier, which is the point', () => {
    expect(tokenizerBaseline([148, 148, 148, 191])).toBe(148);
  });

  it('ignores junk values', () => {
    expect(tokenizerBaseline([0, -5, Number.NaN, 148, 148])).toBe(148);
  });

  it('returns null with nothing usable', () => {
    expect(tokenizerBaseline([])).toBeNull();
    expect(tokenizerBaseline([0])).toBeNull();
  });
});

describe('tokenizerSignal', () => {
  const available = (count: number) => ({ count, available: true, detail: '' });

  it('passes a count that matches the cohort', () => {
    expect(tokenizerSignal(available(148), 148).status).toBe('pass');
  });

  it('passes a count within the tolerance band', () => {
    expect(tokenizerSignal(available(152), 148).status).toBe('pass');
  });

  it('fails a count from a visibly different tokenizer', () => {
    const signal = tokenizerSignal(available(191), 148);
    expect(signal.status).toBe('fail');
    expect(signal.detail).toContain('191');
  });

  it('skips rather than guesses when there is no baseline', () => {
    expect(tokenizerSignal(available(148), null).status).toBe('skip');
  });

  it('skips when the endpoint does not implement count_tokens', () => {
    const signal = tokenizerSignal({ count: null, available: false, detail: 'not implemented' }, 148);
    expect(signal.status).toBe('skip');
  });
});

describe('billedInputTokens', () => {
  const usage = (u: Partial<Usage>): Usage => ({ input_tokens: null, output_tokens: null, ...u });

  it('sums input_tokens with both cache buckets', () => {
    expect(
      billedInputTokens(usage({ input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 })),
    ).toBe(125);
  });

  it('treats absent cache buckets as zero', () => {
    expect(billedInputTokens(usage({ input_tokens: 120 }))).toBe(120);
  });

  it('returns null when usage is null or undefined', () => {
    expect(billedInputTokens(null)).toBeNull();
    expect(billedInputTokens(undefined)).toBeNull();
  });

  it('returns null when input_tokens is missing', () => {
    expect(billedInputTokens(usage({ input_tokens: null, cache_read_input_tokens: 10 }))).toBeNull();
  });
});

describe('systemPromptSignal', () => {
  it('fails when billed input clearly exceeds count_tokens', () => {
    const signal = systemPromptSignal({ countAvailable: true, claimedInput: 120, billedInput: 320 });
    expect(signal.status).toBe('fail');
    expect(signal.weight).toBe('context');
    expect(signal.detail).toContain('320');
    expect(signal.detail).toContain('120');
    expect(signal.detail).toContain('200'); // the ~delta of extra tokens
    // The caveat: a finding about the provider, not proof of a different model.
    expect(signal.detail).toContain('not proof of a different underlying model');
    expect(signal.evidence).toMatchObject({ claimedInput: 120, billedInput: 320, delta: 200 });
  });

  it('passes when billed input is within the tolerance', () => {
    const signal = systemPromptSignal({ countAvailable: true, claimedInput: 120, billedInput: 125 });
    expect(signal.status).toBe('pass');
    expect(signal.weight).toBe('context');
    // Even a pass is not positive proof — padding count_tokens would hide it.
    expect(signal.detail).toContain('not positive proof');
  });

  it('skips when count_tokens was unavailable', () => {
    const signal = systemPromptSignal({ countAvailable: false, claimedInput: null, billedInput: 300 });
    expect(signal.status).toBe('skip');
  });

  it('skips when count_tokens returned no count', () => {
    expect(systemPromptSignal({ countAvailable: true, claimedInput: null, billedInput: 300 }).status).toBe('skip');
  });

  it('skips when the completion reported no input usage', () => {
    expect(systemPromptSignal({ countAvailable: true, claimedInput: 120, billedInput: null }).status).toBe('skip');
  });

  it('skips rather than fails on a large negative delta (never accuse on ambiguous facts)', () => {
    const signal = systemPromptSignal({ countAvailable: true, claimedInput: 320, billedInput: 120 });
    expect(signal.status).toBe('skip');
  });
});

describe('buildSignals', () => {
  const args = { tokenizer: null, tokenizerBaseline: null };

  it('passes the puzzles when every run answered correctly', () => {
    const signals = buildSignals({ ...args, modelId: 'claude-opus-5', runs: [goodRun(0), goodRun(1)] });
    expect(signals.find((s) => s.id === 'puzzle-arithmetic')?.status).toBe('pass');
    expect(signals.find((s) => s.id === 'instruction-following')?.status).toBe('pass');
    expect(signals.find((s) => s.id === 'consistency-check')?.status).toBe('pass');
  });

  it('scores puzzles hard for a flagship tier', () => {
    const signals = buildSignals({ ...args, modelId: 'claude-opus-5', runs: [goodRun(0)] });
    expect(signals.find((s) => s.id === 'puzzle-strawberry')?.weight).toBe('hard');
  });

  it('refuses to score puzzles against a small tier that genuinely fails them', () => {
    const wrong = goodRun(0, 'Claude Haiku 4.5', { text: '1: 408\n2: 2\n3: sum(range(1, 101))\n4: ORANGE\n5: Haiku' });
    const signals = buildSignals({ ...args, modelId: 'claude-haiku-4-5', runs: [wrong] });
    const strawberry = signals.find((s) => s.id === 'puzzle-strawberry');
    expect(strawberry?.status).toBe('fail');
    expect(strawberry?.weight).toBe('soft');
    expect(strawberry?.detail).toContain('not scored');
  });

  it('treats an unknown id the same way — no tier known, so no accusation', () => {
    const signals = buildSignals({ ...args, modelId: 'someco/wizard-13b-v2', runs: [goodRun(0)] });
    expect(signals.find((s) => s.id === 'puzzle-arithmetic')?.weight).toBe('soft');
  });

  it('fails consistency when temperature 0 returns different text each time', () => {
    const runs = [goodRun(0), goodRun(1, 'x', { text: '1: 409\n2: 4\n3: nope\n4: BLUE\n5: x' })];
    expect(buildSignals({ ...args, modelId: 'claude-opus-5', runs }).find((s) => s.id === 'consistency-check')?.status).toBe(
      'fail',
    );
  });

  it('records but does not score a self-report naming the advertised vendor', () => {
    const signals = buildSignals({ ...args, modelId: 'claude-opus-5', runs: [goodRun(0, 'Claude Opus 5')] });
    const self = signals.find((s) => s.id === 'self-reported-vendor');
    expect(self?.status).toBe('skip');
    expect(self?.detail).toContain('proves nothing');
  });

  it('fails the self-report when the model names a different vendor', () => {
    const signals = buildSignals({ ...args, modelId: 'claude-opus-5', runs: [goodRun(0, 'GPT-4o')] });
    const self = signals.find((s) => s.id === 'self-reported-vendor');
    expect(self?.status).toBe('fail');
    expect(self?.detail).toContain('OpenAI');
  });

  it('scores the response-id shape only where the vendor publishes one', () => {
    const anthropic = buildSignals({ ...args, modelId: 'claude-opus-5', runs: [goodRun(0)] });
    expect(anthropic.find((s) => s.id === 'response-id-shape')?.status).toBe('pass');
    const openai = buildSignals({ ...args, modelId: 'gpt-5', runs: [goodRun(0, 'GPT-5')] });
    expect(openai.find((s) => s.id === 'response-id-shape')?.status).toBe('skip');
  });

  it('fails the id shape when an Anthropic id is not msg_-prefixed', () => {
    const runs = [goodRun(0, 'Claude Opus 5', { messageId: 'chatcmpl-9xYz' })];
    expect(buildSignals({ ...args, modelId: 'claude-opus-5', runs }).find((s) => s.id === 'response-id-shape')?.status).toBe(
      'fail',
    );
  });
});

describe('aggregateVerdict', () => {
  it('treats a single hard failure as decisive enough to doubt the label', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-strawberry', 'fail'),
      signal('puzzle-arithmetic', 'pass'),
      signal('puzzle-python-sum', 'pass'),
      signal('response-id-shape', 'pass', 'soft'),
      signal('self-reported-vendor', 'skip', 'soft'),
    ]);
    expect(verdict.verdict).toBe('likely-mismatch');
  });

  it('escalates to a flat mismatch when two hard signals fail', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-strawberry', 'fail'),
      signal('tokenizer-fingerprint', 'fail'),
      signal('puzzle-arithmetic', 'pass'),
    ]);
    expect(verdict.verdict).toBe('mismatch');
  });

  it('reports a clean sweep as matching what was sold', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-arithmetic', 'pass'),
      signal('puzzle-strawberry', 'pass'),
      signal('puzzle-python-sum', 'pass'),
      signal('instruction-following', 'pass', 'soft'),
      signal('response-id-shape', 'pass', 'soft'),
      signal('tokenizer-fingerprint', 'pass'),
      signal('consistency-check', 'pass', 'soft'),
    ]);
    expect(verdict.verdict).toBe('matches-advertised');
    expect(verdict.confidence).toBeGreaterThan(60);
  });

  it('ignores skipped signals rather than counting them against the model', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-arithmetic', 'pass'),
      signal('puzzle-strawberry', 'pass'),
      signal('puzzle-python-sum', 'pass'),
      signal('instruction-following', 'pass', 'soft'),
      signal('tokenizer-fingerprint', 'skip'),
      signal('response-id-shape', 'skip', 'soft'),
    ]);
    expect(verdict.verdict).toBe('matches-advertised');
  });

  it('never lets a provider-level context signal fail an individual model', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-arithmetic', 'pass'),
      signal('puzzle-strawberry', 'pass'),
      signal('puzzle-python-sum', 'pass'),
      signal('model-name-honored', 'fail', 'context'),
      signal('output-ceiling', 'fail', 'context'),
    ]);
    expect(verdict.verdict).toBe('matches-advertised');
  });

  it('returns inconclusive when nothing could be scored', () => {
    const verdict = aggregateVerdict([signal('tokenizer-fingerprint', 'skip')]);
    expect(verdict.verdict).toBe('ambiguous');
    expect(verdict.confidence).toBe(0);
  });

  it('calls a mostly-soft-failing model inconclusive rather than fake', () => {
    const verdict = aggregateVerdict([
      signal('puzzle-arithmetic', 'pass'),
      signal('puzzle-strawberry', 'pass'),
      signal('instruction-following', 'partial', 'soft'),
      signal('self-reported-vendor', 'partial', 'soft'),
      signal('consistency-check', 'fail', 'soft'),
    ]);
    expect(['ambiguous', 'likely-advertised']).toContain(verdict.verdict);
  });

  // A named substitution cannot be averaged away by passing behaviour: it really
  // is a working model, just not the one sold.
  it('overrides everything when the endpoint named a different family', () => {
    const verdict = aggregateVerdict(
      [signal('puzzle-arithmetic', 'pass'), signal('puzzle-strawberry', 'pass'), signal('tokenizer-fingerprint', 'pass')],
      { family: true },
    );
    expect(verdict.verdict).toBe('wrong-tier');
    expect(verdict.confidence).toBeGreaterThan(90);
  });

  it('reports a different vendor above a wrong tier', () => {
    const verdict = aggregateVerdict([signal('puzzle-arithmetic', 'pass')], { vendor: true, family: true });
    expect(verdict.verdict).toBe('different-vendor');
  });
});



