import { describe, expect, it } from 'vitest';
import {
  MODEL_SPECS,
  OUTPUT_BANDS,
  VENDOR_LABEL,
  bareId,
  extractModelIds,
  familyOf,
  isSmallModel,
  namespaceOf,
  nonexistentIdFor,
  specFor,
  vendorLabelOf,
  vendorOf,
} from '@/lib/registry';

describe('bareId', () => {
  it('strips a gateway namespace', () => {
    expect(bareId('anthropic/claude-opus-5')).toBe('claude-opus-5');
    expect(bareId('openrouter/anthropic/claude-opus-5')).toBe('claude-opus-5');
  });

  it('strips a :tag suffix', () => {
    expect(bareId('llama-4-maverick:free')).toBe('llama-4-maverick');
  });

  it('lowercases', () => {
    expect(bareId('Claude-Opus-5')).toBe('claude-opus-5');
  });

  it('survives junk', () => {
    expect(bareId('')).toBe('');
    expect(bareId('   ')).toBe('');
  });
});

describe('namespaceOf', () => {
  it('returns the prefix a gateway used', () => {
    expect(namespaceOf('anthropic/claude-opus-5')).toBe('anthropic/');
  });

  it('returns null when there is none', () => {
    expect(namespaceOf('claude-opus-5')).toBeNull();
  });
});

describe('specFor', () => {
  // Ordering is load-bearing: a shorter pattern placed first would swallow the
  // longer id and report the wrong family, which is a wrong accusation.
  it('prefers the more specific pattern over its prefix', () => {
    expect(familyOf('claude-opus-4-5-20250101')).toBe('Opus 4.5');
    expect(familyOf('claude-opus-4-20250514')).toBe('Opus 4');
    expect(familyOf('gpt-5.2')).toBe('GPT-5.2');
    expect(familyOf('gpt-5-mini')).toBe('GPT-5 mini');
    expect(familyOf('gpt-5')).toBe('GPT-5');
  });

  it('resolves ids for every vendor in the table', () => {
    for (const spec of MODEL_SPECS) {
      expect(VENDOR_LABEL[spec.vendor]).toBeTruthy();
    }
  });

  it('returns null for an id nothing publishes', () => {
    expect(specFor('wizard-13b-uncensored')).toBeNull();
    expect(specFor('')).toBeNull();
  });
});

describe('vendorOf', () => {
  it('identifies each major vendor from a bare id', () => {
    expect(vendorOf('claude-sonnet-5')).toBe('anthropic');
    expect(vendorOf('gpt-4.1')).toBe('openai');
    expect(vendorOf('gemini-2.5-pro')).toBe('google');
    expect(vendorOf('llama-3.3-70b')).toBe('meta');
    expect(vendorOf('deepseek-v3')).toBe('deepseek');
    expect(vendorOf('grok-4')).toBe('xai');
    expect(vendorOf('qwen3-235b')).toBe('alibaba');
    expect(vendorOf('kimi-k2')).toBe('moonshot');
  });

  it('sees through a gateway namespace', () => {
    expect(vendorOf('openrouter/google/gemini-3-pro')).toBe('google');
  });

  it('gives a display label too', () => {
    expect(vendorLabelOf('claude-opus-5')).toBe('Anthropic');
    expect(vendorLabelOf('nothing-real')).toBeNull();
  });
});

describe('isSmallModel', () => {
  it('flags cheap tiers whose puzzle failures are normal', () => {
    expect(isSmallModel('claude-haiku-4-5')).toBe(true);
    expect(isSmallModel('gpt-4o-mini')).toBe(true);
    expect(isSmallModel('gemini-2.5-flash')).toBe(true);
  });

  it('does not flag flagships', () => {
    expect(isSmallModel('claude-opus-5')).toBe(false);
    expect(isSmallModel('gpt-5')).toBe(false);
    expect(isSmallModel('gemini-3-pro')).toBe(false);
  });

  // Not knowing the tier means a wrong answer proves nothing, which is the same
  // situation as a known-small model.
  it('treats an unknown id as small', () => {
    expect(isSmallModel('someco/wizard-13b-v2')).toBe(true);
  });
});

describe('OUTPUT_BANDS', () => {
  it('is derived from the table, so it cannot drift out of step', () => {
    const caps = new Set(MODEL_SPECS.map((s) => s.output));
    expect(new Set(OUTPUT_BANDS)).toEqual(caps);
  });

  it('is ascending, which the binary search depends on', () => {
    expect([...OUTPUT_BANDS]).toEqual([...OUTPUT_BANDS].sort((a, b) => a - b));
  });
});

describe('nonexistentIdFor', () => {
  it('produces an id nothing in the registry matches', () => {
    const fake = nonexistentIdFor('claude-opus-5');
    expect(specFor(fake)).toBeNull();
  });

  // An honest gateway that prefix-matches would accept a near-miss like
  // `claude-opus-5-20991231`, and reporting that as "ignores model names" would
  // accuse a working provider.
  it('is not a near-miss of the requested id', () => {
    expect(nonexistentIdFor('claude-opus-5')).not.toContain('opus');
  });

  it('keeps the gateway namespace so the model is rejected, not the namespace', () => {
    expect(nonexistentIdFor('anthropic/claude-opus-5').startsWith('anthropic/')).toBe(true);
  });
});

describe('extractModelIds', () => {
  it('requires both letters and digits, so prose is not mistaken for an id', () => {
    expect(extractModelIds('the model that served this request')).toEqual([]);
  });

  it('does not treat a URL as a model id', () => {
    expect(extractModelIds('see https://api.example.com/v1/messages')).toEqual([]);
  });

  it('keeps a namespaced unknown id but not a bare unknown word', () => {
    expect(extractModelIds('served by someco/wizard-13b-v2')).toEqual(['someco/wizard-13b-v2']);
    expect(extractModelIds('served by wizard13b')).toEqual([]);
  });
});
