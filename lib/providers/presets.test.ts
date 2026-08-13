import { describe, it, expect } from 'vitest';
import { presetForEndpoint, getPreset } from './presets';

describe('presetForEndpoint', () => {
  it('matches a preset by its own host', () => {
    expect(presetForEndpoint('https://api.anthropic.com').id).toBe('anthropic');
    expect(presetForEndpoint('https://openrouter.ai/api/v1').id).toBe('openrouter');
  });

  it('recognises a Bearer-only reseller no fingerprint knows about', () => {
    // The whole point of the host table: Lumosel is unrecognisable to
    // detectProvider, and defaulting it to x-api-key breaks every request.
    const preset = presetForEndpoint('https://api.lumosel.vip');
    expect(preset.id).toBe('lumosel');
    expect(preset.authStyle).toBe('bearer');
  });

  it('ignores path and trailing slashes when matching the host', () => {
    expect(presetForEndpoint('https://api.anthropic.com/v1/').id).toBe('anthropic');
    expect(presetForEndpoint('api.anthropic.com').id).toBe('anthropic');
  });

  it('falls back to fingerprinting for unknown hosts', () => {
    expect(presetForEndpoint('http://localhost:8787').id).toBe('local');
    expect(presetForEndpoint('https://gateway.example.com').id).toBe('custom');
  });

  it('returns the custom preset for input that is not a URL', () => {
    expect(presetForEndpoint('').id).toBe('custom');
    expect(presetForEndpoint('   ').id).toBe('custom');
  });
});

describe('getPreset', () => {
  it('falls back to custom for an unknown id', () => {
    // @ts-expect-error deliberately outside ProviderId
    expect(getPreset('nope').id).toBe('custom');
  });
});
