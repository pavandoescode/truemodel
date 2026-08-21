import type { AuthStyle, RedirectHop, WireConfig } from '@/lib/types';

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
  /**
   * Every redirect hop followed, in order: where the request was sent, where
   * the server pointed it, and with what status. Empty when the provider
   * answered directly. `authDropped` marks hops to a different host, where the
   * credential headers are deliberately not forwarded (see below).
   */
  redirects: RedirectHop[];
}

/** Headers that carry credentials and must never follow a redirect to another host. */
const CREDENTIAL_HEADER_KEYS = [
  'authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'proxy-authorization',
  'cookie',
];

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

/** Drop credential headers when a redirect crosses to a different host. */
function stripCredentials(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADER_KEYS.includes(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function isPlainObject(x: unknown): x is Record<string, string> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Accept either a plain header record or a Headers instance. */
function headersToRecord(headers: unknown): Record<string, string> {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return isPlainObject(headers) ? { ...headers } : {};
}

/**
 * fetch with an AbortController timeout; never throws. Redirects are followed
 * manually so three things happen on every hop:
 *
 * 1. the hop is recorded — the domain-to-domain trail the trace console shows;
 * 2. `guard`, when given, re-validates the target — the pre-call check only
 *    covers the first URL, and a redirect is exactly how a public endpoint
 *    could otherwise point the request at an internal address;
 * 3. credential headers are dropped when the redirect lands on a different
 *    host, mirroring browser behaviour for `Authorization` — a redirect that
 *    moves the request to an unknown host must not move the API key with it.
 *    The hop is marked `authDropped` so the trail says so plainly.
 */
export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  opts: { guard?: (url: string) => Promise<void> } = {},
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  const started = performance.now();
  const maxRedirects = 10;
  let redirectCount = 0;
  let currentUrl = url;
  const headerSource = headersToRecord(init.headers);
  let currentHeaders: Record<string, string> = { ...headerSource };
  const redirects: RedirectHop[] = [];

  try {
    while (true) {
      const response = await fetch(currentUrl, {
        ...init,
        headers: currentHeaders,
        signal: controller.signal,
        cache: 'no-store' as const,
        redirect: 'manual' as const,
      });
      if (response.status >= 300 && response.status < 400 && response.headers.has('location') && redirectCount < maxRedirects) {
        redirectCount++;
        const location = response.headers.get('location')!;
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).toString();
        } catch {
          // Invalid redirect URL — return the response already in hand rather
          // than re-fetching the same (unparseable-redirect) URL again.
          return { response, latencyMs: Math.round(performance.now() - started), networkError: null, timedOut: false, redirects };
        }
        try {
          // Every hop gets the same treatment as the first URL: a redirect is
          // a fresh destination chosen by the server, not by the user.
          if (opts.guard) await opts.guard(nextUrl);
        } catch (err) {
          return {
            response: null,
            latencyMs: Math.round(performance.now() - started),
            networkError: err instanceof Error ? err : new Error(String(err)),
            timedOut: false,
            redirects,
          };
        }
        const crossHost = !sameHost(currentUrl, nextUrl);
        if (crossHost) currentHeaders = stripCredentials(currentHeaders);
        redirects.push({ from: currentUrl, to: nextUrl, status: response.status, ...(crossHost ? { authDropped: true } : {}) });
        currentUrl = nextUrl;
        continue;
      }
      return { response, latencyMs: Math.round(performance.now() - started), networkError: null, timedOut: false, redirects };
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const timedOut = controller.signal.aborted;
    return {
      response: null,
      latencyMs: Math.round(performance.now() - started),
      networkError: timedOut ? new Error(`Timed out after ${timeoutMs}ms`) : error,
      timedOut,
      redirects,
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
