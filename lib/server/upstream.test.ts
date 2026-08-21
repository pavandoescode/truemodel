import { afterEach, describe, expect, it, vi } from 'vitest';
import { timedFetch } from './upstream';
import type { RedirectHop } from '@/lib/types';

/** Restore the real fetch after every test. */
afterEach(() => {
  vi.unstubAllGlobals();
});

function res(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body || null, { status, headers });
}

/** A fetch stub that answers each URL from a map, recording every call. */
function routeFetch(routes: Record<string, Response>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const stub = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return routes[url] ?? res(404, 'no route for ' + url);
  });
  vi.stubGlobal('fetch', stub);
  return calls;
}

describe('timedFetch redirect trail', () => {
  it('records nothing when the provider answers directly', async () => {
    const calls = routeFetch({ 'https://api.example.com/v1/models': res(200, '[]') });
    const out = await timedFetch('https://api.example.com/v1/models', { headers: { 'x-api-key': 'sk-1' } }, 1000);
    expect(out.response?.status).toBe(200);
    expect(out.redirects).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('follows and records a same-host redirect, keeping the key', async () => {
    const calls = routeFetch({
      'https://api.example.com/v1/messages': res(308, '', { location: 'https://api.example.com/v2/messages' }),
      'https://api.example.com/v2/messages': res(200, '{"ok":true}'),
    });
    const out = await timedFetch(
      'https://api.example.com/v1/messages',
      { method: 'POST', headers: { 'x-api-key': 'sk-1', 'content-type': 'application/json' } },
      1000,
    );
    expect(out.response?.status).toBe(200);
    expect(out.redirects).toEqual<RedirectHop[]>([
      { from: 'https://api.example.com/v1/messages', to: 'https://api.example.com/v2/messages', status: 308 },
    ]);
    expect(out.redirects[0]!.authDropped).toBeUndefined();
    // Same host: the key travelled with the request.
    expect(calls[1]!.headers['x-api-key']).toBe('sk-1');
  });

  it('drops credential headers when a redirect crosses to another host', async () => {
    const calls = routeFetch({
      'https://provider.example.com/v1/messages': res(302, '', { location: 'https://relay.other.io/v1/messages' }),
      'https://relay.other.io/v1/messages': res(200, '{}'),
    });
    const out = await timedFetch(
      'https://provider.example.com/v1/messages',
      { method: 'POST', headers: { authorization: 'Bearer sk-1', 'content-type': 'application/json' } },
      1000,
    );
    expect(out.response?.status).toBe(200);
    expect(out.redirects[0]).toMatchObject({ status: 302, authDropped: true });
    // The hop is marked and the credential did not follow the redirect; the
    // harmless headers did.
    expect(calls[1]!.headers).not.toHaveProperty('authorization');
    expect(calls[1]!.headers['content-type']).toBe('application/json');
  });

  it('resolves relative redirect targets against the current URL', async () => {
    routeFetch({
      'https://api.example.com/v1/messages': res(301, '', { location: '/v2/messages' }),
      'https://api.example.com/v2/messages': res(200, '{}'),
    });
    const out = await timedFetch('https://api.example.com/v1/messages', { headers: {} }, 1000);
    expect(out.redirects[0]!.to).toBe('https://api.example.com/v2/messages');
  });

  it('re-runs the SSRF guard on every hop and keeps the partial trail when it rejects', async () => {
    routeFetch({
      'https://api.example.com/v1/messages': res(302, '', { location: 'http://169.254.169.254/latest/meta-data' }),
    });
    const guard = vi.fn(async (url: string) => {
      if (url.includes('169.254')) throw new Error('Refusing to follow redirect to a private address.');
    });
    const out = await timedFetch('https://api.example.com/v1/messages', { headers: { 'x-api-key': 'k' } }, 1000, { guard });
    expect(out.response).toBeNull();
    expect(out.networkError?.message).toContain('private address');
    expect(guard).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data');
    expect(out.redirects).toEqual([]);
  });

  it('chains multiple hops in order and marks only the cross-host ones', async () => {
    routeFetch({
      'https://a.example.com/x': res(301, '', { location: 'https://a.example.com/y' }),
      'https://a.example.com/y': res(302, '', { location: 'https://b.example.net/z' }),
      'https://b.example.net/z': res(200, '{}'),
    });
    const out = await timedFetch('https://a.example.com/x', { headers: { 'x-api-key': 'k' } }, 1000);
    expect(out.redirects.map((h) => `${h.from}host:${h.status}:${!!h.authDropped}`)).toEqual([
      'https://a.example.com/xhost:301:false',
      'https://a.example.com/yhost:302:true',
    ]);
    expect(out.response?.status).toBe(200);
  });

  it('stops at the redirect cap and returns the last redirect response', async () => {
    // Every URL redirects to the next integer path; the loop must give up at
    // 10 hops rather than chase forever.
    const routes: Record<string, Response> = {};
    for (let i = 0; i < 30; i += 1) {
      routes[`https://loop.example.com/${i}`] = res(302, '', { location: `https://loop.example.com/${i + 1}` });
    }
    routeFetch(routes);
    const out = await timedFetch('https://loop.example.com/0', { headers: {} }, 1000);
    expect(out.redirects).toHaveLength(10);
    // The 11th response is the redirect itself, surfaced rather than looped on.
    expect(out.response?.status).toBe(302);
  });
});
