/**
 * Saved provider profiles — named endpoint + key + remark + tested models,
 * persisted in localStorage so a provider can be re-applied to the dashboard
 * in one click instead of being retyped.
 *
 * Storage is intentionally separate from `lib/simpleStorage.ts` (which holds the
 * single "current" config): profiles are a library the user curates, the
 * current config is scratch state.
 */

import type { AuthStyle, HeaderPair, ProviderConfig, ProviderId } from '@/lib/types';
import { defaultConfig } from '@/lib/simpleStorage';

const PROFILES_KEY = 'ccpv:profiles';

export const ALIAS_KEYS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
export type AliasKey = (typeof ALIAS_KEYS)[number];
export type AliasMappings = Record<AliasKey, string>;

export interface SavedProfile {
  id: string;
  /** User-facing label, e.g. "FreeModel gateway". */
  name: string;
  remark: string;
  presetId: ProviderId;
  endpoint: string;
  /** Empty string when the user chose not to store the key. */
  apiKey: string;
  authStyle: AuthStyle;
  anthropicVersion: string;
  appendV1: boolean;
  /** Custom headers configured for this provider (e.g. HTTP-Referer, api-key). */
  headers: HeaderPair[];
  /** Model IDs that passed (or partially passed) when the profile was saved. */
  testedModels: string[];
  /** Alias → model ID mapping last used for this provider. */
  mappings: AliasMappings;
  createdAt: number;
  updatedAt: number;
}

export function emptyMappings(): AliasMappings {
  return { opus: '', sonnet: '', haiku: '', fable: '' };
}

function newId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/** Coerce one stored entry into a valid profile, or null if unusable. */
function parseProfile(value: unknown): SavedProfile | null {
  if (!isRecord(value)) return null;
  const endpoint = str(value.endpoint).trim();
  const name = str(value.name).trim();
  if (!endpoint || !name) return null;

  const mappings = emptyMappings();
  if (isRecord(value.mappings)) {
    for (const alias of ALIAS_KEYS) {
      mappings[alias] = str(value.mappings[alias]).trim();
    }
  }

  const testedModels = Array.isArray(value.testedModels)
    ? value.testedModels.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
    : [];

  const headers: HeaderPair[] = Array.isArray(value.headers)
    ? value.headers
        .filter(isRecord)
        .map((h, i): HeaderPair | null => {
          const key = str(h.key);
          if (!key) return null;
          return {
            id: str(h.id) || `h_${i}_${Date.now().toString(36)}`,
            key,
            value: str(h.value),
            enabled: typeof h.enabled === 'boolean' ? h.enabled : true,
          };
        })
        .filter((h): h is HeaderPair => h !== null)
    : [];

  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();

  return {
    id: str(value.id) || newId(),
    name,
    remark: str(value.remark),
    presetId: (str(value.presetId, 'custom') as ProviderId) || 'custom',
    endpoint,
    apiKey: str(value.apiKey),
    authStyle: value.authStyle === 'bearer' ? 'bearer' : 'x-api-key',
    anthropicVersion: str(value.anthropicVersion) || defaultConfig('anthropic').anthropicVersion,
    appendV1: typeof value.appendV1 === 'boolean' ? value.appendV1 : true,
    headers,
    testedModels: Array.from(new Set(testedModels)),
    mappings,
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
  };
}

/** Newest-updated first. Never throws — corrupt storage yields an empty list. */
export function loadProfiles(): SavedProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseProfile)
      .filter((p): p is SavedProfile => p !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeProfiles(profiles: SavedProfile[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    /* storage blocked / quota — the in-memory list still works this session */
  }
}

export interface ProfileDraft {
  name: string;
  remark: string;
  config: ProviderConfig;
  testedModels: string[];
  mappings: AliasMappings;
  /** When false the key is not persisted; applying asks for it again. */
  includeKey: boolean;
  /** Set to overwrite an existing profile instead of adding one. */
  id?: string;
}

/**
 * Insert or update a profile and persist. Returns the new list so callers can
 * set state from a single source of truth.
 */
export function upsertProfile(draft: ProfileDraft): { profiles: SavedProfile[]; profile: SavedProfile } {
  const existing = loadProfiles();
  const now = Date.now();
  const prior = draft.id ? existing.find((p) => p.id === draft.id) : undefined;

  const profile: SavedProfile = {
    id: prior?.id ?? newId(),
    name: draft.name.trim(),
    remark: draft.remark.trim(),
    presetId: draft.config.presetId,
    endpoint: draft.config.endpoint.trim(),
    apiKey: draft.includeKey ? draft.config.apiKey.trim() : '',
    authStyle: draft.config.authStyle,
    anthropicVersion: draft.config.anthropicVersion,
    appendV1: draft.config.appendV1 ?? true,
    headers: draft.config.headers.map((h) => ({ ...h })),
    testedModels: Array.from(new Set(draft.testedModels.filter(Boolean))),
    mappings: { ...emptyMappings(), ...draft.mappings },
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };

  const next = [profile, ...existing.filter((p) => p.id !== profile.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  writeProfiles(next);
  return { profiles: next, profile };
}

export function deleteProfile(id: string): SavedProfile[] {
  const next = loadProfiles().filter((p) => p.id !== id);
  writeProfiles(next);
  return next;
}

/** Normalize endpoint to base URL only (remove /dashboard, /v1, trailing slashes). */
function normalizeEndpointForMatching(endpoint: string): string {
  let normalized = endpoint.trim().replace(/\/+$/, '');
  try {
    const url = new URL(normalized);
    // Keep protocol and host, remove path, query, hash
    normalized = `${url.protocol}//${url.host}`;
  } catch {
    // Fallback: just lowercase and remove trailing slashes
    normalized = normalized.toLowerCase().replace(/\/+$/, '');
  }
  // Remove /dashboard path if present
  normalized = normalized.replace(/\/dashboard\/?$/i, '');
  // Remove /v1 if present
  normalized = normalized.replace(/\/v1\/?$/i, '');
  normalized = normalized.replace(/\/+$/, '');
  return normalized.toLowerCase();
}

/** Match a saved profile by endpoint so "Save" can offer to update it. */
export function findProfileByEndpoint(profiles: SavedProfile[], endpoint: string): SavedProfile | undefined {
  const target = normalizeEndpointForMatching(endpoint);
  if (!target) return undefined;
  return profiles.find((p) => normalizeEndpointForMatching(p.endpoint) === target);
}

/**
 * Turn a saved profile back into a dashboard config. Restores the headers
 * that were configured when the profile was saved (falling back to the
 * preset's default headers only for profiles saved before headers were
 * tracked, or if the profile has none).
 */
export function configFromProfile(profile: SavedProfile): ProviderConfig {
  const base = defaultConfig(profile.presetId);
  return {
    ...base,
    endpoint: profile.endpoint,
    apiKey: profile.apiKey,
    authStyle: profile.authStyle,
    anthropicVersion: profile.anthropicVersion || base.anthropicVersion,
    appendV1: profile.appendV1,
    headers: profile.headers.length > 0 ? profile.headers.map((h) => ({ ...h })) : base.headers,
  };
}

/** Host shown in the profile list, falling back to the raw string. */
export function profileHost(profile: SavedProfile): string {
  try {
    return new URL(profile.endpoint).host;
  } catch {
    return profile.endpoint;
  }
}
