import { describe, expect, it } from 'vitest';
import {
  detectVendor,
  expectedLimits,
  extractModelIds,
  familiesWithCeiling,
  OUTPUT_BANDS,
  parseLimitError,
  rankFamilyCandidates,
  scanHeadersForModel,
} from '@/lib/attribution';
import { attributionSignals, attributionSummary, resolveServedModel } from '@/lib/identity';
import { familyOf } from '@/lib/registry';
import type { Attribution, NameSource } from '@/lib/types';

describe('OUTPUT_BANDS', () => {
  it('is ascending and free of duplicates', () => {
    const sorted = [...OUTPUT_BANDS].sort((a, b) => a - b);
    expect(OUTPUT_BANDS).toEqual(sorted);
    expect(new Set(OUTPUT_BANDS).size).toBe(OUTPUT_BANDS.length);
  });

  it('spans the small legacy caps through the current large ones', () => {
    expect(OUTPUT_BANDS[0]).toBeLessThanOrEqual(8_192);
    expect(OUTPUT_BANDS[OUTPUT_BANDS.length - 1]).toBeGreaterThanOrEqual(64_000);
  });
});

describe('expectedLimits', () => {
  it('resolves a current model id to its vendor, family and cap', () => {
    expect(expectedLimits('claude-haiku-4-5')).toEqual({
      vendor: 'anthropic',
      family: 'Haiku 4.5',
      output: 64_000,
      context: 200_000,
      caps: 'exact',
    });
  });

  it('resolves namespaced ids from gateways', () => {
    expect(expectedLimits('anthropic/claude-opus-5')?.family).toBe('Opus 5');
  });

  it('resolves non-Anthropic ids too, which is the whole point', () => {
    expect(expectedLimits('gpt-4o')?.vendor).toBe('openai');
    expect(expectedLimits('gemini-3-pro')?.vendor).toBe('google');
    expect(expectedLimits('llama-4-maverick')?.vendor).toBe('meta');
  });

  it('marks non-Anthropic caps approximate, so they are never scored', () => {
    expect(expectedLimits('gpt-5')?.caps).toBe('approx');
    expect(expectedLimits('claude-opus-5')?.caps).toBe('exact');
  });

  it('returns null for an id no vendor publishes', () => {
    expect(expectedLimits('wizard-13b-uncensored')).toBeNull();
  });
});

describe('familiesWithCeiling', () => {
  it('lists current families sharing a cap', () => {
    expect(familiesWithCeiling(64_000)).toContain('Haiku 4.5');
  });

  it('excludes deprecated families, which would only add noise', () => {
    expect(familiesWithCeiling(64_000)).not.toContain('Sonnet 4.5');
  });

  it('narrows to one vendor when the vendor is known', () => {
    const anthropicOnly = familiesWithCeiling(128_000, 'anthropic');
    expect(anthropicOnly).toContain('Opus 5');
    expect(anthropicOnly).not.toContain('GPT-5');
  });

  it('returns nothing for a cap no family uses', () => {
    expect(familiesWithCeiling(12_345)).toEqual([]);
  });
});

describe('detectVendor', () => {
  it('finds a vendor named outright', () => {
    const guess = detectVendor(['I am a large language model trained by OpenAI.']);
    expect(guess.vendor).toBe('OpenAI');
    expect(guess.vendorId).toBe('openai');
    expect(guess.quotes[0]).toContain('OpenAI');
  });

  it('prefers the unexpected vendor when both appear', () => {
    // The spoofing case: told to say Claude, but the real lineage leaks.
    const guess = detectVendor(['I am Claude.', 'My underlying model is Llama 3 from Meta.'], 'anthropic');
    expect(guess.vendor).toBe('Meta');
    expect(guess.mentions).toContain('Anthropic');
  });

  it('is symmetric — an OpenAI label with an Anthropic leak reads the same way', () => {
    const guess = detectVendor(['I am GPT-5.', 'Actually I am Claude, made by Anthropic.'], 'openai');
    expect(guess.vendor).toBe('Anthropic');
  });

  it('reports the expected vendor when that is all that was said', () => {
    expect(detectVendor(['I am Claude, made by Anthropic.'], 'anthropic').vendor).toBe('Anthropic');
  });

  it('recognises vendors by model name alone', () => {
    expect(detectVendor(['qwen2.5-72b-instruct']).vendor).toBe('Alibaba');
    expect(detectVendor(['I am Gemini.']).vendor).toBe('Google');
    expect(detectVendor(['mixtral-8x7b']).vendor).toBe('Mistral');
  });

  it('returns null when no vendor is named', () => {
    const guess = detectVendor(['I am an AI assistant.', '']);
    expect(guess.vendor).toBeNull();
    expect(guess.quotes).toEqual([]);
  });

  it('ignores empty text', () => {
    expect(detectVendor(['', '   ']).vendor).toBeNull();
  });
});

describe('parseLimitError', () => {
  it('pulls the cap and the resolved model id out of a real Anthropic error', () => {
    const msg =
      'max_tokens: 9000000 > 128000, which is the maximum allowed number of output tokens for claude-opus-4-20250514';
    expect(parseLimitError(msg)).toEqual({ cap: 128_000, modelId: 'claude-opus-4-20250514' });
  });

  it('still finds the cap when no model is named', () => {
    expect(parseLimitError('max_tokens: 9000000 > 64000').cap).toBe(64_000);
  });

  it('reads the phrasings other vendors use', () => {
    expect(parseLimitError('max_tokens must be <= 4096').cap).toBe(4_096);
    expect(parseLimitError('maximum of 8192 completion tokens').cap).toBe(8_192);
    expect(parseLimitError('value must be at most 16384').cap).toBe(16_384);
  });

  it('returns nulls for an unrelated error', () => {
    expect(parseLimitError('invalid x-api-key')).toEqual({ cap: null, modelId: null });
  });

  it('returns nulls for empty input', () => {
    expect(parseLimitError('')).toEqual({ cap: null, modelId: null });
  });
});

describe('extractModelIds', () => {
  it('finds dated snapshot ids', () => {
    expect(extractModelIds('serving claude-sonnet-4-5-20250929 now')).toEqual(['claude-sonnet-4-5-20250929']);
  });

  it('finds ids from any vendor, not just Anthropic', () => {
    expect(extractModelIds('routed to gpt-4o-mini instead')).toEqual(['gpt-4o-mini']);
    expect(extractModelIds('upstream: gemini-2.5-flash')).toEqual(['gemini-2.5-flash']);
  });

  it('strips trailing punctuation', () => {
    expect(extractModelIds('model is claude-opus-5.')).toEqual(['claude-opus-5']);
  });

  it('deduplicates repeats', () => {
    expect(extractModelIds('claude-opus-5 vs claude-opus-5')).toHaveLength(1);
  });

  it('ignores the bare word claude with no version', () => {
    expect(extractModelIds('I am Claude, an AI assistant.')).toEqual([]);
  });

  it('keeps a namespaced id from a vendor it does not know', () => {
    // Still a finding: something other than the advertised model answered.
    expect(extractModelIds('upstream someco/wizard-13b-v2 replied')).toContain('someco/wizard-13b-v2');
  });
});

describe('scanHeadersForModel', () => {
  it('picks up an upstream model header', () => {
    expect(scanHeadersForModel({ 'x-upstream-model': 'gpt-4o-mini' })).toEqual(['gpt-4o-mini']);
  });

  it('ignores unrelated headers', () => {
    expect(scanHeadersForModel({ 'content-type': 'application/json' })).toEqual([]);
  });

  it('does not mistake a region for a model', () => {
    expect(scanHeadersForModel({ 'x-model-region': 'us-east-1' })).toEqual([]);
  });

  it('handles missing headers', () => {
    expect(scanHeadersForModel(null)).toEqual([]);
  });
});

describe('resolveServedModel', () => {
  const empty = { requested: 'claude-opus-5', reportedModels: [], errorIds: [], headerIds: [] };

  it('prefers the response model field above all else', () => {
    const got = resolveServedModel({
      ...empty,
      reportedModels: ['claude-sonnet-4-5'],
      errorIds: ['claude-haiku-4-5'],
    });
    expect(got).toEqual({ id: 'claude-sonnet-4-5', source: 'response-model' });
  });

  it('falls back to an error-named id that disagrees with the request', () => {
    const got = resolveServedModel({ ...empty, errorIds: ['claude-sonnet-4-5'] });
    expect(got.source).toBe('error-message');
  });

  it('uses a header when nothing better is available', () => {
    const got = resolveServedModel({ ...empty, headerIds: ['claude-haiku-4-5'] });
    expect(got.source).toBe('response-header');
  });

  it('reports nothing when no source named a model', () => {
    expect(resolveServedModel(empty)).toEqual({ id: null, source: 'none' });
  });
});

const base: Attribution = {
  servedModelId: null,
  servedFamily: null,
  servedVendor: null,
  nameSource: 'none' as NameSource,
  requestedFamily: 'Opus 5',
  requestedVendor: 'Anthropic',
  familyMismatch: false,
  vendorMismatch: false,
  nameHonored: 'honored',
  probedFakeId: 'not-a-real-model-9v9-20991231',
  measuredCeiling: null,
  unvalidatedCeiling: false,
  candidateFamilies: [],
  rankedCandidates: [],
  advertised: { vendor: 'Anthropic', family: 'Opus 5', output: 128_000, context: 1_000_000, capsExact: true },
  claimedVendor: null,
  vendorMentions: [],
  quotes: [],
  summary: '',
};

describe('attributionSummary', () => {
  // The reported bug: a real model from the right vendor, but the wrong one.
  it('names the real model when Sonnet is served behind an Opus label', () => {
    const text = attributionSummary(
      {
        ...base,
        servedModelId: 'claude-sonnet-4-5-20250929',
        servedFamily: 'Sonnet 4.5',
        servedVendor: 'Anthropic',
        nameSource: 'response-model',
        familyMismatch: true,
      },
      'claude-opus-5',
    );
    expect(text).toContain('Serving Sonnet 4.5');
    expect(text).toContain('claude-sonnet-4-5-20250929');
    expect(text).toContain('not the Opus 5 you requested');
  });

  it('names the vendor when a different company answered entirely', () => {
    const text = attributionSummary(
      {
        ...base,
        servedModelId: 'gpt-4o-mini',
        servedFamily: 'GPT-4o mini',
        servedVendor: 'OpenAI',
        nameSource: 'response-header',
        familyMismatch: true,
        vendorMismatch: true,
      },
      'claude-opus-5',
    );
    expect(text).toContain("OpenAI's GPT-4o mini");
    expect(text).toContain('upstream response header');
  });

  it('does not cry substitution over a dated snapshot of the same family', () => {
    const text = attributionSummary(
      {
        ...base,
        servedModelId: 'claude-opus-5-20260115',
        servedFamily: 'Opus 5',
        servedVendor: 'Anthropic',
        nameSource: 'response-model',
      },
      'claude-opus-5',
    );
    expect(text).toContain('Serving Opus 5');
    expect(text).not.toContain('not the');
  });

  it('reports an endpoint that ignores the model name entirely', () => {
    const text = attributionSummary({ ...base, nameHonored: 'ignored' }, 'claude-opus-5');
    expect(text).toContain('not routing on the model name');
  });

  it('says plainly when a clean result is unconfirmed rather than implying proof', () => {
    const text = attributionSummary(base, 'claude-opus-5');
    expect(text).toContain('nothing confirmed it');
    expect(text).toContain('different tier');
  });

  it('calls out a ceiling below the advertised family', () => {
    const text = attributionSummary({ ...base, measuredCeiling: 8_192 }, 'claude-opus-5');
    expect(text).toContain('not the 128,000');
    expect(text).toContain('8,192');
  });

  it('confirms a ceiling that matches what was advertised', () => {
    const text = attributionSummary({ ...base, measuredCeiling: 128_000 }, 'claude-opus-5');
    expect(text).toContain('matching Opus 5 as advertised');
  });

  it('refuses to score a ceiling for a vendor that clamps instead of rejecting', () => {
    const text = attributionSummary(
      {
        ...base,
        requestedFamily: 'GPT-5',
        requestedVendor: 'OpenAI',
        advertised: { vendor: 'OpenAI', family: 'GPT-5', output: 128_000, context: 400_000, capsExact: false },
        measuredCeiling: 16_384,
      },
      'gpt-5',
    );
    expect(text).toContain('not evidence by itself');
  });

  it('explains that an endpoint enforcing no limit is a proxy', () => {
    const text = attributionSummary({ ...base, unvalidatedCeiling: true }, 'claude-opus-5');
    expect(text).toContain('no output limit');
  });

  it('reports a vendor the model named against the label', () => {
    const text = attributionSummary({ ...base, claimedVendor: 'OpenAI', vendorMentions: ['OpenAI'] }, 'claude-opus-5');
    expect(text).toContain('named OpenAI rather than Anthropic');
  });

  it('flags a self-report that contradicts the findings', () => {
    const text = attributionSummary(
      { ...base, nameHonored: 'ignored', claimedVendor: 'Anthropic', vendorMentions: ['Anthropic'] },
      'claude-opus-5',
    );
    expect(text).toContain('spoofing system prompt');
  });

  it('never fabricates a specific model name it did not observe', () => {
    const text = attributionSummary({ ...base, measuredCeiling: 8_192 }, 'claude-opus-5');
    expect(text).not.toContain('Serving');
  });
});

describe('familyOf', () => {
  it('maps a dated snapshot to its family', () => {
    expect(familyOf('claude-sonnet-4-5-20250929')).toBe(familyOf('claude-sonnet-4-5'));
  });

  it('maps non-Anthropic ids as readily as Anthropic ones', () => {
    expect(familyOf('gpt-4o-mini')).toBe('GPT-4o mini');
    expect(familyOf('deepseek-r1')).toBe('DeepSeek R1');
  });

  it('returns null for an id no vendor publishes', () => {
    expect(familyOf('wizard-13b-uncensored')).toBeNull();
  });
});

describe('attributionSignals', () => {
  it('fails the served-model signal on a confirmed family mismatch', () => {
    const signals = attributionSignals(
      {
        ...base,
        servedModelId: 'claude-sonnet-4-5',
        servedFamily: 'Sonnet 4.5',
        nameSource: 'response-model',
        familyMismatch: true,
      },
      'claude-opus-5',
    );
    const served = signals.find((s) => s.id === 'served-model-id');
    expect(served?.status).toBe('fail');
    expect(served?.weight).toBe('hard');
    expect(served?.detail).toContain('Sonnet 4.5');
  });

  it('passes when the endpoint resolves the alias to a dated snapshot', () => {
    const signals = attributionSignals(
      { ...base, servedModelId: 'claude-opus-5-20260115', servedFamily: 'Opus 5', nameSource: 'response-model' },
      'claude-opus-5',
    );
    expect(signals.find((s) => s.id === 'served-model-id')?.status).toBe('pass');
  });

  it('skips rather than passes when no model name was ever leaked', () => {
    const signals = attributionSignals(base, 'claude-opus-5');
    const served = signals.find((s) => s.id === 'served-model-id');
    expect(served?.status).toBe('skip');
    expect(served?.detail).toContain('echoed');
  });

  it('fails name routing when a nonexistent id is answered, but only as context', () => {
    const signals = attributionSignals({ ...base, nameHonored: 'ignored' }, 'claude-opus-5');
    const honored = signals.find((s) => s.id === 'model-name-honored');
    expect(honored?.status).toBe('fail');
    // Provider-level: real, but not proof about this particular response.
    expect(honored?.weight).toBe('context');
  });

  it('scores the ceiling for a vendor that enforces its cap', () => {
    const good = attributionSignals({ ...base, measuredCeiling: 128_000 }, 'claude-opus-5');
    expect(good.find((s) => s.id === 'output-ceiling')?.status).toBe('pass');
    const bad = attributionSignals({ ...base, measuredCeiling: 8_192 }, 'claude-opus-5');
    const signal = bad.find((s) => s.id === 'output-ceiling');
    expect(signal?.status).toBe('fail');
    expect(signal?.weight).toBe('hard');
  });

  it('records but does not score the ceiling for a vendor that clamps', () => {
    const signals = attributionSignals(
      {
        ...base,
        requestedFamily: 'GPT-5',
        requestedVendor: 'OpenAI',
        advertised: { vendor: 'OpenAI', family: 'GPT-5', output: 128_000, context: 400_000, capsExact: false },
        measuredCeiling: 16_384,
      },
      'gpt-5',
    );
    const signal = signals.find((s) => s.id === 'output-ceiling');
    expect(signal?.status).toBe('skip');
    expect(signal?.weight).toBe('context');
    expect(signal?.detail).toContain('16,384');
  });

  it('skips the ceiling entirely for an id the registry does not know', () => {
    const signals = attributionSignals(
      { ...base, requestedFamily: null, requestedVendor: null, advertised: null, measuredCeiling: 8_192 },
      'wizard-13b-uncensored',
    );
    expect(signals.find((s) => s.id === 'output-ceiling')?.status).toBe('skip');
  });
});



describe('rankFamilyCandidates', () => {
  const baseInput = {
    requestedId: 'claude-opus-5',
    measuredCeiling: null as number | null,
    ceilingValidated: true,
    vendorHint: null,
    claimedVendorId: null,
    acedPuzzles: null as boolean | null,
    knownThrough: null as number | null,
  };

  it('returns nothing when no evidence was measured at all', () => {
    expect(rankFamilyCandidates(baseInput)).toEqual([]);
  });

  it('ranks families whose enforced cap matches above the rest', () => {
    const ranked = rankFamilyCandidates({ ...baseInput, measuredCeiling: 128_000 });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.score).toBe(100);
    // Every top candidate shares the measured cap.
    expect(['Opus 5', 'Sonnet 5', 'Fable 5', 'Mythos 5', 'GPT-5.2', 'GPT-5.1', 'GLM-4']).toContain(ranked[0]!.family);
    expect(ranked[0]!.why.some((w) => w.includes('output cap matches'))).toBe(true);
  });

  it('excludes other vendors outright when the serving stack named one', () => {
    const ranked = rankFamilyCandidates({ ...baseInput, vendorHint: 'openai', claimedVendorId: 'openai' });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((c) => c.vendor === 'OpenAI')).toBe(true);
  });

  it('rewards a knowledge horizon that fits the family window', () => {
    const withCeiling = rankFamilyCandidates({ ...baseInput, measuredCeiling: 128_000 });
    const withCutoff = rankFamilyCandidates({
      ...baseInput,
      measuredCeiling: 128_000,
      // Knows through 2025-04: fits Opus 5's 2026 window, not any 2021 family.
      knownThrough: 2025 * 12 + 3,
    });
    const scoreOf = (r: typeof withCutoff, family: string) => r.find((c) => c.family === family)?.score ?? 0;
    // GPT-3.5's window ends 2021-12; a model knowing 2025-04 cannot be it, so
    // its score must fall relative to the same ranking without the horizon.
    expect(scoreOf(withCutoff, 'GPT-3.5')).toBeLessThanOrEqual(scoreOf(withCeiling, 'GPT-3.5'));
  });

  it('boosts small tiers when the puzzles were missed', () => {
    const missed = rankFamilyCandidates({ ...baseInput, measuredCeiling: 64_000, acedPuzzles: false });
    const top = missed[0]!;
    expect(top.why.some((w) => w.includes('small tier'))).toBe(true);
  });

  it('keeps scores relative: the top candidate is always 100', () => {
    const ranked = rankFamilyCandidates({ ...baseInput, measuredCeiling: 32_768, acedPuzzles: true });
    expect(ranked[0]!.score).toBe(100);
    expect(ranked.every((c) => c.score >= 1 && c.score <= 100)).toBe(true);
  });
});
