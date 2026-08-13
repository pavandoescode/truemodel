import type { AuthStyle, WireConfig } from '@/lib/types';

export const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'proxy-authorization',
  'cookie',
  'set-cookie',
];

/** Replace all but the last 4 characters of a secret. */
export function maskSecret(value: string): string {
  if (!value) return '';
  const tail = value.slice(-4);
  const head = value.length > 12 ? value.slice(0, 7) : '';
  return `${head}${head ? '…' : ''}${'•'.repeat(6)}${tail}`;
}

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_KEYS.includes(k.toLowerCase()) ? maskSecret(v) : v;
  }
  return out;
}

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

/**
 * Join endpoint + path, collapsing a duplicated `/v1` segment so that both
 * `https://host` and `https://host/v1` work with a `/v1/messages` path.
 */
export function buildUrl(endpoint: string, path: string, query?: Record<string, string>): string {
  const base = normalizeEndpoint(endpoint);
  let suffix = path.startsWith('/') ? path : `/${path}`;
  if (/\/v1$/i.test(base) && /^\/v1(\/|$)/i.test(suffix)) suffix = suffix.slice(3) || '/';
  const url = new URL(`${base}${suffix}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

export function authHeaders(apiKey: string, style: AuthStyle): Record<string, string> {
  if (!apiKey) return {};
  return style === 'bearer' ? { authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey };
}

export function buildUpstreamHeaders(config: WireConfig, opts: { json: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'anthropic-version': config.anthropicVersion || '2023-06-01',
    ...authHeaders(config.apiKey, config.authStyle),
  };
  if (opts.json) headers['content-type'] = 'application/json';
  for (const [k, v] of Object.entries(config.headers ?? {})) {
    if (!k.trim()) continue;
    headers[k.toLowerCase()] = v;
  }
  return headers;
}

export function collectHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export class ConfigError extends Error {}

/** Validate and normalise the config supplied by the browser. */
export function parseWireConfig(input: unknown): WireConfig {
  const raw = input as Partial<WireConfig> | undefined;
  if (!raw || typeof raw !== 'object') throw new ConfigError('Missing config.');
  let endpoint = normalizeEndpoint(String(raw.endpoint ?? ''));
  if (!endpoint) throw new ConfigError('Endpoint is required.');
  
  // Auto-prepend https:// if no protocol was supplied by the user
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = `https://${endpoint}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ConfigError(`"${endpoint}" is not a valid URL. Include the scheme, e.g. https://api.anthropic.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`Unsupported scheme "${parsed.protocol}". Use http:// or https://`);
  }
  const headers: Record<string, string> = {};
  const rawHeaders = raw.headers;
  if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
    for (const [k, v] of Object.entries(rawHeaders)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string') headers[k.trim()] = v;
    }
  }
  return {
    endpoint,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    headers,
    authStyle: raw.authStyle === 'bearer' ? 'bearer' : 'x-api-key',
    anthropicVersion: typeof raw.anthropicVersion === 'string' && raw.anthropicVersion ? raw.anthropicVersion : '2023-06-01',
  };
}

export interface FetchOutcome {
  response: Response | null;
  latencyMs: number;
  networkError: Error | null;
  timedOut: boolean;
}

/** fetch with an AbortController timeout; never throws. */
export async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  const started = performance.now();
  const maxRedirects = 10;
  let redirectCount = 0;
  let currentUrl = url;
  let currentInit = { ...init, signal: controller.signal, cache: 'no-store' as const, redirect: 'manual' as const };

  try {
    while (true) {
      const response = await fetch(currentUrl, currentInit);
      if (response.status >= 300 && response.status < 400 && response.headers.has('location') && redirectCount < maxRedirects) {
        redirectCount++;
        const location = response.headers.get('location')!;
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          // Invalid redirect URL — return the response already in hand rather
          // than re-fetching the same (unparseable-redirect) URL again.
          return { response, latencyMs: Math.round(performance.now() - started), networkError: null, timedOut: false };
        }
        continue;
      }
      return { response, latencyMs: Math.round(performance.now() - started), networkError: null, timedOut: false };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = controller.signal.aborted;
    return {
      response: null,
      latencyMs: Math.round(performance.now() - started),
      networkError: timedOut ? new Error(`Timed out after ${timeoutMs}ms`) : error,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function safeJson(text: string): { data: unknown; ok: boolean; isHtml?: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { data: null, ok: true };
  if (trimmed.startsWith('<') || trimmed.toLowerCase().startsWith('<!doctype') || trimmed.toLowerCase().startsWith('<html')) {
    return { data: null, ok: false, isHtml: true };
  }
  try {
    return { data: JSON.parse(text), ok: true };
  } catch {
    return { data: null, ok: false };
  }
}
