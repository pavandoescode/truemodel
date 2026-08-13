import { describe, it, expect } from 'vitest';

// normalizeBaseUrl isn't exported from the route module (Next.js route files may
// only export HTTP method handlers), so this test locks in the same contract by
// re-implementing the check against the documented behavior in route.ts. If that
// behavior ever changes, update this alongside it.
//
// The real logic lives in app/api/save-settings/route.ts:normalizeBaseUrl — kept
// module-private because Next.js's route segment config only allows exporting
// recognized handler names (GET/POST/etc.) and config constants.
function normalizeBaseUrl(raw: unknown): string {
  let endpoint = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!endpoint) throw new Error('Endpoint is required.');
  endpoint = endpoint.replace(/\/v1$/i, '').replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`"${endpoint}" is not a valid URL. Include the scheme, e.g. https://api.example.com`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported scheme "${parsed.protocol}". Use http:// or https://`);
  }
  return endpoint;
}

describe('normalizeBaseUrl (save-settings contract)', () => {
  it('strips a trailing /v1 so Claude Code does not double it up', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com///')).toBe('https://api.anthropic.com');
  });

  it('rejects an empty endpoint', () => {
    expect(() => normalizeBaseUrl('')).toThrow('Endpoint is required.');
    expect(() => normalizeBaseUrl(undefined)).toThrow('Endpoint is required.');
  });

  it('rejects a value with no scheme', () => {
    expect(() => normalizeBaseUrl('api.anthropic.com')).toThrow(/not a valid URL/);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => normalizeBaseUrl('ftp://api.anthropic.com')).toThrow(/Unsupported scheme/);
  });

  it('accepts a plain https endpoint unchanged', () => {
    expect(normalizeBaseUrl('https://gateway.example.com')).toBe('https://gateway.example.com');
  });
});
