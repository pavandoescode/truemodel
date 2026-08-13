/**
 * API Key Configuration Management
 * Handles storage, validation, and retrieval of a provider API key — whoever's
 * models that provider resells.
 * Uses lightweight obfuscation (NOT encryption) with optional persistence —
 * see `obfuscate`/`deobfuscate` below for exactly what protection this gives.
 */

export interface ApiKeyConfig {
  apiKey: string;
  /** Empty means auto-detect: ask the endpoint what it serves. */
  model: string;
  endpoint: string;
  provider: 'anthropic' | 'openrouter' | 'custom';
  lastValidated?: number;
  isValid?: boolean;
}

export interface ConfigStorageOptions {
  encrypt?: boolean;
  persist?: boolean;
}

const STORAGE_KEY = 'claude_api_config';
const SESSION_KEY = 'claude_api_session';

/** Storage-only shape: tracks whether `apiKey` below is obfuscated, so load
 * doesn't have to guess from the string's contents (that heuristic used to
 * check for a literal "=" character, which is only sometimes present in
 * base64 output depending on padding — it silently left the key obfuscated
 * on a false negative). */
interface StoredApiKeyConfig extends ApiKeyConfig {
  __obfuscated?: boolean;
}

/**
 * Simple XOR-based obfuscation (not cryptography-grade, just prevents casual reading)
 * For production, use actual encryption library
 *
 * XORs at the UTF-8 byte level (not UTF-16 code units) before base64-encoding,
 * so keys containing non-Latin1 characters (accents, CJK, emoji) round-trip
 * correctly instead of throwing out of `btoa`.
 */
export function obfuscate(text: string, key: string = 'opencode-claude'): string {
  const bytes = new TextEncoder().encode(text);
  let result = '';
  for (let i = 0; i < bytes.length; i++) {
    result += String.fromCharCode(bytes[i] ^ (key.charCodeAt(i % key.length) & 0xff));
  }
  return btoa(result); // Base64 encode
}

export function deobfuscate(encoded: string, key: string = 'opencode-claude'): string {
  try {
    const binary = atob(encoded); // Base64 decode
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) ^ (key.charCodeAt(i % key.length) & 0xff);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Save API key configuration
 */
export function saveApiKeyConfig(
  config: ApiKeyConfig,
  options: ConfigStorageOptions = {}
): void {
  if (typeof window === 'undefined') return;

  const { encrypt = true, persist = false } = options;

  // Obfuscate the API key, and record that we did so — load needs this flag,
  // not a guess based on what the encoded string happens to look like.
  const dataToStore: StoredApiKeyConfig =
    encrypt && config.apiKey
      ? { ...config, apiKey: obfuscate(config.apiKey), __obfuscated: true }
      : { ...config };

  const serialized = JSON.stringify(dataToStore);

  // Store in session (always)
  try {
    sessionStorage.setItem(SESSION_KEY, serialized);
  } catch {
    console.warn('Failed to save to sessionStorage');
  }

  // Optionally persist to localStorage
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      console.warn('Failed to save to localStorage');
    }
  }
}

/**
 * Load API key configuration from storage
 */
export function loadApiKeyConfig(): ApiKeyConfig | null {
  if (typeof window === 'undefined') return null;

  let data: string | null = null;

  // Try session first, then localStorage
  try {
    data = sessionStorage.getItem(SESSION_KEY);
  } catch {
    // Session storage not available
  }

  if (!data) {
    try {
      data = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Local storage not available
    }
  }

  if (!data) return null;

  try {
    const { __obfuscated, ...config } = JSON.parse(data) as StoredApiKeyConfig;

    if (config.apiKey && __obfuscated) {
      config.apiKey = deobfuscate(config.apiKey);
    }

    return config;
  } catch {
    console.warn('Failed to parse stored config');
    return null;
  }
}

/**
 * Clear API key configuration from storage
 */
export function clearApiKeyConfig(): void {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage not available
  }
}

/**
 * Mask API key for display (show last 4 chars only)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 4) return '••••';
  return '••••' + key.slice(-4);
}

/**
 * Get current active config
 */
export function getActiveConfig(): ApiKeyConfig | null {
  return loadApiKeyConfig();
}

/**
 * Update specific fields in config
 */
export function updateApiKeyConfig(
  updates: Partial<ApiKeyConfig>,
  options: ConfigStorageOptions = {}
): ApiKeyConfig | null {
  // No model is named by default: an empty id means "ask the endpoint what it
  // serves", which is the only honest default for a reseller whose catalogue
  // we cannot know in advance.
  const current = loadApiKeyConfig() || {
    apiKey: '',
    model: '',
    endpoint: 'https://api.anthropic.com',
    provider: 'anthropic',
  };

  const updated = { ...current, ...updates };
  saveApiKeyConfig(updated, options);
  return updated;
}
