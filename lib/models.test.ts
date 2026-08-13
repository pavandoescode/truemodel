import { describe, it, expect } from 'vitest';
import { normalizeModels, pickDefaultModel, isHardDiscoveryFailure, FALLBACK_MODELS } from './models';
import { classifyError } from './errors';
import type { ProxyResponse } from './types';

function response(status: number, message: string, withError = true): ProxyResponse<unknown> {
  return {
    ok: false,
    status,
    statusText: message,
    latencyMs: 12,
    headers: {},
    data: null,
    rawText: '',
    error: withError ? classifyError({ status, message }) : null,
    url: 'https://api.example.test/v1/models',
    sentHeaders: {},
  };
}

describe('isHardDiscoveryFailure', () => {
  // The fallback lineup exists for exactly this case: no catalogue published,
  // which says nothing about whether the key or the endpoint works.
  it('treats a 404 on /v1/models as benign', () => {
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(404, 'Not Found'), isFallback: true })).toBe(false);
  });

  // Probing four models with a rejected key yields four identical auth errors
  // dressed up as readings — a false report from a tool built to avoid those.
  it('treats a rejected key as a real failure', () => {
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(401, 'invalid x-api-key'), isFallback: true })).toBe(true);
  });

  it('treats an unreachable host and a 5xx as real failures', () => {
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(0, 'fetch failed'), isFallback: true })).toBe(true);
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(503, 'Service Unavailable'), isFallback: true })).toBe(true);
  });

  it('never fires when a real catalogue came back', () => {
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(401, 'nope'), isFallback: false })).toBe(false);
  });

  // An endpoint that answers 200 with an empty list is odd but not broken.
  it('stays quiet when the fallback carries no error at all', () => {
    expect(isHardDiscoveryFailure({ models: FALLBACK_MODELS, response: response(200, 'OK', false), isFallback: true })).toBe(false);
  });
});

describe('FALLBACK_MODELS', () => {
  it('lists only current-generation ids, none deprecated', () => {
    const ids = FALLBACK_MODELS.map((m) => m.id);
    expect(ids).toEqual([
      'claude-fable-5',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5-20251001',
    ]);
    expect(FALLBACK_MODELS.every((m) => m.deprecated === false)).toBe(true);
  });

  // The limits shown to the user are the ones the identity probe will hold the
  // endpoint to, so they have to come from the registry, not from this list.
  it('takes its limits and vendor from the registry', () => {
    const haiku = FALLBACK_MODELS.find((m) => m.id === 'claude-haiku-4-5-20251001')!;
    expect(haiku.vendor).toBe('Anthropic');
    expect(haiku.family).toBe('Haiku 4.5');
    expect(haiku.maxOutput).toBe(64_000);
    expect(haiku.contextWindow).toBe(200_000);
  });

  it('does not contain any retired 3.x-era ids', () => {
    const ids = FALLBACK_MODELS.map((m) => m.id);
    expect(ids.some((id) => /3-5-sonnet|3-opus|claude-2|claude-instant/.test(id))).toBe(false);
  });
});

describe('normalizeModels', () => {
  it('parses an Anthropic-style { data: [...] } payload', () => {
    const models = normalizeModels({
      data: [{ id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5' }],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('claude-sonnet-5');
    expect(models[0].displayName).toBe('Claude Sonnet 5');
    expect(models[0].vendor).toBe('Anthropic');
    expect(models[0].deprecated).toBe(false);
    expect(models[0].family).toBe('Sonnet 5');
  });

  it('parses an OpenRouter-style { models: [...] } payload with namespaced ids', () => {
    const models = normalizeModels({
      models: [{ id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' }],
    });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('anthropic/claude-sonnet-5');
    expect(models[0].vendor).toBe('Anthropic');
  });

  // The tool is for any provider's catalogue, so a non-Anthropic id has to
  // resolve as fully as an Anthropic one.
  it('resolves other vendors from their ids too', () => {
    const models = normalizeModels({
      data: [{ id: 'gpt-4o' }, { id: 'gemini-3-pro' }, { id: 'llama-4-maverick' }],
    });
    expect(models.map((m) => m.vendor)).toEqual(['OpenAI', 'Google', 'Meta']);
    expect(models[0].maxOutput).toBe(16_384);
    expect(models[1].family).toBe('Gemini 3 Pro');
  });

  it('leaves the vendor null for an id no registry entry matches', () => {
    const [model] = normalizeModels({ data: [{ id: 'someco/wizard-13b-v2' }] });
    expect(model.vendor).toBeNull();
    expect(model.family).toBeNull();
  });

  it('prefers the provider’s own published limits over the registry', () => {
    const [model] = normalizeModels({
      data: [{ id: 'claude-sonnet-5', context_window: 123_456, max_output_tokens: 4_096 }],
    });
    expect(model.contextWindow).toBe(123_456);
    expect(model.maxOutput).toBe(4_096);
  });

  it('parses a bare array of id strings', () => {
    const models = normalizeModels(['claude-opus-5', 'gpt-4o']);
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5', 'gpt-4o']);
    expect(models[0].vendor).toBe('Anthropic');
    expect(models[1].vendor).toBe('OpenAI');
  });

  it('returns an empty list for an unrecognized payload shape', () => {
    expect(normalizeModels({ nonsense: true })).toEqual([]);
    expect(normalizeModels(null)).toEqual([]);
    expect(normalizeModels(undefined)).toEqual([]);
  });

  it('flags retired ids as deprecated with the correct family', () => {
    const [model] = normalizeModels({ data: [{ id: 'claude-3-5-sonnet-20241022' }] });
    expect(model.deprecated).toBe(true);
    expect(model.family).toBe('Sonnet 3.5');
  });

  it('does not flag current-generation ids as deprecated', () => {
    const [model] = normalizeModels({ data: [{ id: 'claude-sonnet-5' }] });
    expect(model.deprecated).toBe(false);
  });

  it('marks the second occurrence of a namespaced duplicate id', () => {
    const models = normalizeModels({
      data: [{ id: 'anthropic/claude-sonnet-5' }, { id: 'bedrock/claude-sonnet-5' }],
    });
    expect(models[0].duplicateOf).toBeNull();
    expect(models[1].duplicateOf).toBe('anthropic/claude-sonnet-5');
  });

  it('falls back to `name` as the id when `id`/`model`/`model_name` are absent', () => {
    // Some gateways (e.g. Ollama) only return a `name` field — pick() treats
    // that as a valid id source rather than dropping the entry.
    const models = normalizeModels({ data: [{ name: 'llama3' }, { id: 'claude-opus-5' }] });
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('llama3');
    expect(models[1].id).toBe('claude-opus-5');
  });

  it('skips entries with no resolvable id at all', () => {
    const models = normalizeModels({ data: [{ description: 'no id-like field present' }, { id: 'claude-opus-5' }] });
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('claude-opus-5');
  });
});

describe('pickDefaultModel', () => {
  it('returns null for an empty list', () => {
    expect(pickDefaultModel([])).toBeNull();
  });

  // No vendor is favoured: a default is just the cheapest recognised current
  // model to smoke-test with, whoever made it.
  it('prefers a cheap current tier over a flagship, regardless of vendor', () => {
    const models = normalizeModels({ data: [{ id: 'gpt-5' }, { id: 'gemini-2.5-flash' }] });
    expect(pickDefaultModel(models)).toBe('gemini-2.5-flash');
  });

  it('prefers a recognised id over one the registry cannot check', () => {
    const models = normalizeModels({ data: [{ id: 'someco/wizard-13b-v2' }, { id: 'claude-sonnet-5' }] });
    expect(pickDefaultModel(models)).toBe('claude-sonnet-5');
  });

  it('prefers a current model over a deprecated one from the same vendor', () => {
    const models = normalizeModels({ data: [{ id: 'claude-3-5-sonnet-20241022' }, { id: 'claude-sonnet-5' }] });
    expect(pickDefaultModel(models)).toBe('claude-sonnet-5');
  });
});
