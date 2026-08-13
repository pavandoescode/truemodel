import { describe, it, expect, beforeEach } from 'vitest';
import {
  obfuscate,
  deobfuscate,
  saveApiKeyConfig,
  loadApiKeyConfig,
  clearApiKeyConfig,
  maskApiKey,
  updateApiKeyConfig,
  type ApiKeyConfig,
} from './apiKeyConfig';

describe('obfuscate / deobfuscate', () => {
  it('round-trips a typical API key', () => {
    const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(deobfuscate(obfuscate(key))).toBe(key);
  });

  it('round-trips an empty string', () => {
    expect(deobfuscate(obfuscate(''))).toBe('');
  });

  it('round-trips unicode content', () => {
    const value = 'clé-données-测试-🔑';
    expect(deobfuscate(obfuscate(value))).toBe(value);
  });

  it('does not store the plaintext key in the obfuscated output', () => {
    const key = 'sk-ant-super-secret-value';
    expect(obfuscate(key)).not.toContain(key);
  });

  it('returns an empty string for garbage input instead of throwing', () => {
    expect(deobfuscate('not-valid-base64!!!')).toBe('');
  });

  it('supports a custom XOR key for both directions', () => {
    const value = 'hello world';
    const customKey = 'my-custom-key';
    expect(deobfuscate(obfuscate(value, customKey), customKey)).toBe(value);
  });
});

describe('maskApiKey', () => {
  it('shows only the last 4 characters', () => {
    expect(maskApiKey('sk-ant-1234567890')).toBe('••••7890');
  });

  it('masks short strings entirely', () => {
    expect(maskApiKey('abc')).toBe('••••');
  });

  it('masks an empty string', () => {
    expect(maskApiKey('')).toBe('••••');
  });
});

describe('saveApiKeyConfig / loadApiKeyConfig', () => {
  const baseConfig: ApiKeyConfig = {
    apiKey: 'sk-ant-real-secret-key',
    model: 'claude-sonnet-5',
    endpoint: 'https://api.anthropic.com',
    provider: 'anthropic',
    isValid: true,
  };

  beforeEach(() => {
    clearApiKeyConfig();
  });

  it('round-trips a config through sessionStorage with the key obfuscated at rest', () => {
    saveApiKeyConfig(baseConfig);

    // The raw value sitting in storage must not contain the plaintext key.
    const raw = sessionStorage.getItem('claude_api_session');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(baseConfig.apiKey);

    const loaded = loadApiKeyConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.apiKey).toBe(baseConfig.apiKey);
    expect(loaded?.model).toBe(baseConfig.model);
    expect(loaded?.endpoint).toBe(baseConfig.endpoint);
  });

  it('does not persist to localStorage unless persist is requested', () => {
    saveApiKeyConfig(baseConfig, { persist: false });
    expect(localStorage.getItem('claude_api_config')).toBeNull();
  });

  it('persists to localStorage when persist is true', () => {
    saveApiKeyConfig(baseConfig, { persist: true });
    const raw = localStorage.getItem('claude_api_config');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(baseConfig.apiKey);
  });

  it('clearApiKeyConfig removes both storage locations', () => {
    saveApiKeyConfig(baseConfig, { persist: true });
    clearApiKeyConfig();
    expect(sessionStorage.getItem('claude_api_session')).toBeNull();
    expect(localStorage.getItem('claude_api_config')).toBeNull();
    expect(loadApiKeyConfig()).toBeNull();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadApiKeyConfig()).toBeNull();
  });
});

describe('updateApiKeyConfig', () => {
  beforeEach(() => {
    clearApiKeyConfig();
  });

  // An empty model means auto-detect. Naming a vendor's id here would make the
  // stored config claim a model the endpoint may not even sell.
  it('leaves the model empty for auto-detection when no config exists yet', () => {
    const updated = updateApiKeyConfig({ apiKey: 'sk-ant-new-key' });
    expect(updated?.model).toBe('');
    expect(updated?.apiKey).toBe('sk-ant-new-key');
  });

  it('merges into an existing saved config', () => {
    saveApiKeyConfig({
      apiKey: 'sk-ant-original',
      model: 'claude-opus-5',
      endpoint: 'https://api.anthropic.com',
      provider: 'anthropic',
    });

    const updated = updateApiKeyConfig({ model: 'claude-haiku-4-5-20251001' });
    expect(updated?.apiKey).toBe('sk-ant-original');
    expect(updated?.model).toBe('claude-haiku-4-5-20251001');
  });
});
