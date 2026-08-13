import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit, clientKey, rateLimitHeaders, resetRateLimits } from './rateLimit';

function req(ip: string): Request {
  return new Request('http://localhost/api/proxy', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('clientKey', () => {
  it('takes the first hop of x-forwarded-for', () => {
    expect(clientKey(req('203.0.113.9, 10.0.0.1, 10.0.0.2'))).toBe('203.0.113.9');
  });

  it('falls back to x-real-ip, then a shared bucket', () => {
    const withReal = new Request('http://localhost/api/proxy', {
      method: 'POST',
      headers: { 'x-real-ip': '198.51.100.4' },
    });
    expect(clientKey(withReal)).toBe('198.51.100.4');
    expect(clientKey(new Request('http://localhost/api/proxy', { method: 'POST' }))).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    delete process.env.DISABLE_RATE_LIMIT;
  });

  it('allows up to the limit then refuses', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit(req('1.2.3.4'), { max: 3 }).allowed).toBe(true);
    }
    const denied = checkRateLimit(req('1.2.3.4'), { max: 3 });
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it('counts each client separately', () => {
    checkRateLimit(req('1.2.3.4'), { max: 1 });
    expect(checkRateLimit(req('1.2.3.4'), { max: 1 }).allowed).toBe(false);
    expect(checkRateLimit(req('5.6.7.8'), { max: 1 }).allowed).toBe(true);
  });

  it('reports remaining budget accurately', () => {
    expect(checkRateLimit(req('9.9.9.9'), { max: 5 }).remaining).toBe(4);
    expect(checkRateLimit(req('9.9.9.9'), { max: 5 }).remaining).toBe(3);
  });

  it('starts a fresh window once the old one has expired', () => {
    vi.useFakeTimers();
    try {
      expect(checkRateLimit(req('4.4.4.4'), { max: 1, windowMs: 1000 }).allowed).toBe(true);
      expect(checkRateLimit(req('4.4.4.4'), { max: 1, windowMs: 1000 }).allowed).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(checkRateLimit(req('4.4.4.4'), { max: 1, windowMs: 1000 }).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('can be switched off for self-hosting', () => {
    process.env.DISABLE_RATE_LIMIT = '1';
    for (let i = 0; i < 10; i += 1) {
      expect(checkRateLimit(req('7.7.7.7'), { max: 1 }).allowed).toBe(true);
    }
  });
});

describe('rateLimitHeaders', () => {
  it('adds retry-after only when refusing', () => {
    expect(rateLimitHeaders({ allowed: true, remaining: 4, retryAfterSec: 0, limit: 5 })).toEqual({
      'x-ratelimit-limit': '5',
      'x-ratelimit-remaining': '4',
    });
    expect(rateLimitHeaders({ allowed: false, remaining: -1, retryAfterSec: 30, limit: 5 })).toEqual({
      'x-ratelimit-limit': '5',
      'x-ratelimit-remaining': '0',
      'retry-after': '30',
    });
  });
});
