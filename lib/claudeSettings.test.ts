import { describe, it, expect } from 'vitest';
import { buildClaudeSettings, buildClaudeSettingsJson, baseUrlForClaude } from './claudeSettings';

describe('baseUrlForClaude', () => {
  it('strips a trailing /v1 so Claude Code does not produce /v1/v1', () => {
    expect(baseUrlForClaude('https://api.example.com/v1')).toBe('https://api.example.com');
  });
  it('strips trailing slashes', () => {
    expect(baseUrlForClaude('https://api.example.com/')).toBe('https://api.example.com');
  });
  it('leaves a bare host untouched', () => {
    expect(baseUrlForClaude('https://api.example.com')).toBe('https://api.example.com');
  });
});

describe('buildClaudeSettings', () => {
  it('writes x-api-key style keys into ANTHROPIC_API_KEY', () => {
    const s = buildClaudeSettings({
      endpoint: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      authStyle: 'x-api-key',
      mappings: {},
    });
    const env = s.env as Record<string, string>;
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('writes bearer keys into ANTHROPIC_AUTH_TOKEN', () => {
    const s = buildClaudeSettings({
      endpoint: 'https://api.example.com',
      apiKey: 'tok-test',
      authStyle: 'bearer',
      mappings: {},
    });
    const env = s.env as Record<string, string>;
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok-test');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('maps aliases to ANTHROPIC_DEFAULT_<ALIAS>_MODEL and picks a primary', () => {
    const s = buildClaudeSettings({
      endpoint: 'https://api.example.com',
      apiKey: 'k',
      authStyle: 'x-api-key',
      mappings: { opus: 'big-model', sonnet: 'mid-model' },
    });
    const env = s.env as Record<string, string>;
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('big-model');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('mid-model');
    // sonnet outranks opus in PRIMARY_ORDER.
    expect(s.model).toBe('sonnet');
  });

  it('omits the model field when nothing is mapped', () => {
    const s = buildClaudeSettings({
      endpoint: 'https://api.example.com',
      apiKey: 'k',
      authStyle: 'x-api-key',
      mappings: {},
    });
    expect(s.model).toBeUndefined();
  });

  it('produces valid JSON ending in a newline', () => {
    const json = buildClaudeSettingsJson({
      endpoint: 'https://api.example.com',
      apiKey: 'k',
      authStyle: 'x-api-key',
      mappings: { haiku: 'small' },
    });
    expect(json.endsWith('\n')).toBe(true);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
