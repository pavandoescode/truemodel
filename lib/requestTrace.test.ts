import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  beginTrace,
  clearTraces,
  completeTrace,
  getTraces,
  legBreakdown,
  patchTrace,
  subscribeToTraces,
  upstreamHost,
} from './requestTrace';

beforeEach(() => {
  clearTraces();
});

describe('trace store', () => {
  it('opens a trace as in-flight with the request facts', () => {
    const t = beginTrace({ kind: 'proxy', method: 'POST', path: '/v1/messages', model: 'claude-opus-5' });
    expect(t.done).toBe(false);
    expect(t.model).toBe('claude-opus-5');
    expect(t.path).toBe('/v1/messages');
    expect(getTraces()).toHaveLength(1);
  });

  it('completes a trace with both legs and marks it done', () => {
    const t = beginTrace({ kind: 'proxy', method: 'GET', path: '/v1/models' });
    completeTrace(t.id, {
      clientTotalMs: 500,
      upstreamUrl: 'https://api.example.com/v1/models',
      sentHeaders: { 'x-api-key': '••••' },
      upstreamStatus: 200,
      upstreamMs: 460,
      responseHeaders: {},
      ok: true,
      preview: '{"data":[]}',
    });
    const stored = getTraces()[0]!;
    expect(stored.done).toBe(true);
    expect(stored.upstreamStatus).toBe(200);
    expect(stored.upstreamUrl).toBe('https://api.example.com/v1/models');
    // The two-leg decomposition: client total minus the server-measured
    // upstream time is the browser↔app leg.
    expect(legBreakdown(stored)).toEqual({ appLegMs: 40, upstreamLegMs: 460 });
  });

  it('patches without closing — a stream learns its URL at open, finishes at done', () => {
    const t = beginTrace({ kind: 'stream', method: 'POST', path: '/v1/messages', model: 'claude-opus-5' });
    patchTrace(t.id, {
      upstreamUrl: 'https://relay.example.org/v1/messages',
      upstreamStatus: 200,
      sentHeaders: { authorization: 'Bearer ••••' },
    });
    let stored = getTraces()[0]!;
    expect(stored.upstreamUrl).toBe('https://relay.example.org/v1/messages');
    expect(stored.done).toBe(false); // still streaming
    completeTrace(t.id, { clientTotalMs: 1200, upstreamMs: 1150, ok: true, eventCount: 34 });
    stored = getTraces()[0]!;
    expect(stored.done).toBe(true);
    // Facts patched earlier survive the completion.
    expect(stored.sentHeaders).toEqual({ authorization: 'Bearer ••••' });
  });

  it('never reports a negative browser↔app leg', () => {
    const t = beginTrace({ kind: 'ping', method: 'GET', path: '/' });
    // Clock skew or a padded upstream number can invert the subtraction.
    completeTrace(t.id, { clientTotalMs: 100, upstreamMs: 150 });
    expect(legBreakdown(getTraces()[0]!).appLegMs).toBe(0);
  });

  it('notifies subscribers on open, patch, complete and clear', () => {
    const seen: number[] = [];
    const unsub = subscribeToTraces((ts) => seen.push(ts.length));
    const t = beginTrace({ kind: 'proxy', method: 'GET', path: '/v1/models' });
    completeTrace(t.id, { clientTotalMs: 10 });
    clearTraces();
    expect(seen).toEqual([0, 1, 1, 0]);
    unsub();
  });

  it('hands the current snapshot to a new subscriber immediately', () => {
    beginTrace({ kind: 'proxy', method: 'GET', path: '/v1/models' });
    let latest: unknown = null;
    subscribeToTraces((ts) => {
      latest = ts.length;
    });
    expect(latest).toBe(1);
  });

  it('keeps only the most recent traces and ignores completions for evicted ids', () => {
    for (let i = 0; i < 160; i += 1) {
      beginTrace({ kind: 'proxy', method: 'GET', path: `/v1/models` });
    }
    expect(getTraces()).toHaveLength(150);
    // The first ten ids fell off the front; completing one must be a no-op.
    expect(() => completeTrace(1, { clientTotalMs: 5 })).not.toThrow();
    expect(getTraces()[0]!.done).toBe(false);
  });

  it('extracts the upstream host for the one-line summary', () => {
    const t = beginTrace({ kind: 'proxy', method: 'GET', path: '/v1/models' });
    completeTrace(t.id, { clientTotalMs: 5, upstreamUrl: 'https://api.anthropic.com/v1/models?beta=true' });
    expect(upstreamHost(getTraces()[0]!)).toBe('api.anthropic.com');
  });

  it('never touches localStorage — the trace is session-memory only', () => {
    const spy = vi.fn();
    const original = globalThis.localStorage;
    try {
      // A bare stub: any attempt to persist would call the spy and fail loudly.
      (globalThis as Record<string, unknown>).localStorage = { setItem: spy, getItem: () => null };
      const t = beginTrace({ kind: 'proxy', method: 'GET', path: '/v1/models' });
      completeTrace(t.id, { clientTotalMs: 5 });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      (globalThis as Record<string, unknown>).localStorage = original;
    }
  });
});
