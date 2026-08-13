import type { ProviderConfig } from '@/lib/types';
import { getPreset } from '@/lib/providers/presets';

const CONFIG_KEY = 'ccpv:simple-config';

export const ANTHROPIC_VERSION = '2023-06-01';

function headerPair(key = '', value = ''): { id: string; key: string; value: string; enabled: boolean } {
  return { id: Math.random().toString(36).slice(2, 10), key, value, enabled: true };
}

export function defaultConfig(presetId: ProviderConfig['presetId'] = 'anthropic'): ProviderConfig {
  const preset = getPreset(presetId);
  const headers = preset.headers.map((h) => headerPair(h.key, h.value));
  return {
    presetId: preset.id,
    endpoint: preset.endpoint,
    apiKey: '',
    headers: [...headers, headerPair()],
    authStyle: preset.authStyle,
    anthropicVersion: ANTHROPIC_VERSION,
    appendV1: true,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseConfig(value: unknown): ProviderConfig | null {
  if (!isRecord(value)) return null;
  const presetId = typeof value.presetId === 'string' ? (value.presetId as ProviderConfig['presetId']) : 'custom';
  const base = defaultConfig(presetId);
  const storedHeaders = Array.isArray(value.headers) ? value.headers : [];
  const mergedHeaders = [...base.headers];
  for (const stored of storedHeaders) {
    if (isRecord(stored)) {
      const key = stored.key;
      if (typeof key === 'string' && key.trim()) {
        const existingIdx = mergedHeaders.findIndex(h => h.key.toLowerCase() === key.toLowerCase());
        const headerPair = {
          id: typeof stored.id === 'string' ? stored.id : Math.random().toString(36).slice(2, 10),
          key: key.trim(),
          value: typeof stored.value === 'string' ? stored.value : '',
          enabled: typeof stored.enabled === 'boolean' ? stored.enabled : true,
        };
        if (existingIdx >= 0) {
          mergedHeaders[existingIdx] = headerPair;
        } else {
          mergedHeaders.push(headerPair);
        }
      }
    }
  }
  // Always ensure at least one empty header row for adding new ones
  if (mergedHeaders.length === 0 || mergedHeaders[mergedHeaders.length - 1].key.trim() !== '') {
    mergedHeaders.push(headerPair());
  }
  return {
    ...base,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : base.endpoint,
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    authStyle: value.authStyle === 'bearer' ? 'bearer' : 'x-api-key',
    anthropicVersion: typeof value.anthropicVersion === 'string' && value.anthropicVersion
      ? value.anthropicVersion
      : base.anthropicVersion,
    appendV1: typeof value.appendV1 === 'boolean' ? value.appendV1 : true,
    headers: mergedHeaders,
  };
}

export function loadConfig(): ProviderConfig {
  if (typeof window === 'undefined') return defaultConfig('anthropic');
  try {
    const stored = window.localStorage.getItem(CONFIG_KEY);
    if (!stored) return defaultConfig('anthropic');
    return parseConfig(JSON.parse(stored)) ?? defaultConfig('anthropic');
  } catch {
    return defaultConfig('anthropic');
  }
}

export function saveConfig(config: ProviderConfig, persistKey: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const toStore = { ...config, apiKey: persistKey ? config.apiKey : '' };
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(toStore));
  } catch {
    /* storage blocked / quota — ignore */
  }
}

export function clearConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}
