/**
 * Core shared contracts: provider configuration, the server-side proxy
 * envelope, Anthropic Messages API shapes, logging, and rate limits.
 *
 * Everything in `lib/types/*` is re-exported from `@/lib/types`.
 */

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export type ProviderId =
  | 'anthropic'
  | 'openrouter'
  | 'litellm'
  | 'requesty'
  | 'lumosel'
  | 'bedrock'
  | 'vertex'
  | 'azure'
  | 'local'
  | 'custom';

export type AuthStyle = 'x-api-key' | 'bearer';

export interface HeaderPair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ProviderPreset {
  id: ProviderId;
  name: string;
  /** Single glyph/emoji used as the provider mark. */
  icon: string;
  /** Short tagline shown under the name in the preset picker. */
  blurb: string;
  endpoint: string;
  authStyle: AuthStyle;
  /** Headers pre-filled into the header editor when the preset is picked. */
  headers: { key: string; value: string }[];
  /** Provider-specific advice surfaced in the connection panel. */
  tips: string[];
  docsUrl?: string;
  /** Accent colour token used for the provider chip. */
  accent: string;
}

/** The full, user-editable provider configuration. */
export interface ProviderConfig {
  presetId: ProviderId;
  endpoint: string;
  apiKey: string;
  headers: HeaderPair[];
  authStyle: AuthStyle;
  /** Value sent as `anthropic-version`. */
  anthropicVersion: string;
  /** Whether to automatically append /v1 to endpoint URL if not present. */
  appendV1?: boolean;
}

/** Config as sent to our own API routes (headers flattened). */
export interface WireConfig {
  endpoint: string;
  apiKey: string;
  headers: Record<string, string>;
  authStyle: AuthStyle;
  anthropicVersion: string;
}

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'auth-failed'
  | 'invalid-endpoint'
  | 'timeout'
  | 'error';

export interface ConnectionResult {
  state: ConnectionState;
  latencyMs: number | null;
  message: string;
  detail?: string;
  httpStatus?: number | null;
  detectedProvider: ProviderId | null;
  detectionReasons: string[];
  modelCount: number | null;
  at: number;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type ErrorCategory =
  | 'auth'
  | 'rate-limit'
  | 'invalid-model'
  | 'invalid-request'
  | 'network'
  | 'timeout'
  | 'malformed-json'
  | 'not-found'
  | 'server'
  | 'overloaded'
  | 'cors'
  | 'unknown';

export interface ApiError {
  category: ErrorCategory;
  /** Short human-readable headline, e.g. "Invalid API key". */
  title: string;
  /** Raw message from the provider, when available. */
  message: string;
  httpStatus: number | null;
  /** Provider error `type` field, when present. */
  providerType?: string | null;
  /** Actionable remediation steps, most likely fix first. */
  suggestions: string[];
  raw?: unknown;
}
