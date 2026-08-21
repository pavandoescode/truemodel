/**
 * Live request trace store.
 *
 * Every provider call this app makes travels two hops: the browser → this
 * app's own /api route → the provider, and the same path back. Both hops are
 * already measured — the routes return the resolved upstream URL, the masked
 * request headers, and the server-side upstream latency on every response — so
 * assembling a hop-by-hop trace of where each request went, and what came
 * back, is pure bookkeeping in the browser. No extra requests, no server
 * changes, nothing persisted: the store lives in memory for the session and
 * can be cleared at any time.
 *
 * Privacy rule, same as the receipt: the API key never enters a trace. The
 * routes mask auth headers before returning them (`x-api-key: ••••`), and
 * nothing here records request bodies — only the model id a body names, which
 * is the label a reader actually needs.
 */

import type { ApiError, RedirectHop, Usage } from '@/lib/types';

/** Which of the app's routes carried the request. */
export type TraceKind = 'proxy' | 'stream' | 'ping';

export interface RequestTrace {
  /** Session-unique, monotonically increasing. */
  id: number;
  /** When the request left the browser. */
  at: number;
  kind: TraceKind;
  method: string;
  /** The path requested from the provider, e.g. /v1/messages. */
  path: string;
  /** The model id the request body named, when it named one. */
  model: string | null;

  /* ---- leg 1: browser → this app's route, and back ---- */
  /** Total browser-side round trip, measured client-side. */
  clientTotalMs: number | null;

  /* ---- leg 2: this app's route → the provider, and back ---- */
  /** The URL the route actually called, resolved from the endpoint + path. */
  upstreamUrl: string | null;
  /** Headers the route sent upstream, secrets already masked by the route. */
  sentHeaders: Record<string, string> | null;
  /** Provider's HTTP status, 0 when the route never got a response. */
  upstreamStatus: number | null;
  /** Upstream round trip, measured server-side by the route. */
  upstreamMs: number | null;
  responseHeaders: Record<string, string> | null;

  /* ---- what came back ---- */
  done: boolean;
  ok: boolean;
  error: ApiError | null;
  usage: Usage | null;
  /** SSE events received, for streamed requests. */
  eventCount: number | null;
  /** First characters of the response body — enough to recognise, not to flood. */
  preview: string | null;
  /**
   * Domain-to-domain redirects the server followed on this request, oldest
   * first. Null/empty when the provider answered the first URL directly.
   */
  redirectChain: RedirectHop[] | null;
}

/** How many traces to keep. Old ones fall off the front; the console is a tail. */
const MAX_TRACES = 150;

type Listener = (traces: readonly RequestTrace[]) => void;

let nextId = 1;
let traces: RequestTrace[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = traces;
  for (const l of listeners) l(snapshot);
}

/** Subscribe to trace updates. Returns an unsubscribe function. */
export function subscribeToTraces(listener: Listener): () => void {
  listeners.add(listener);
  listener(traces);
  return () => {
    listeners.delete(listener);
  };
}

/** Current snapshot, newest last. */
export function getTraces(): readonly RequestTrace[] {
  return traces;
}

/** Drop every trace. */
export function clearTraces(): void {
  traces = [];
  emit();
}

/** Open a trace when a request leaves the browser. Internal to lib/apiClient. */
export function beginTrace(entry: {
  kind: TraceKind;
  method: string;
  path: string;
  model?: string | null;
}): RequestTrace {
  const trace: RequestTrace = {
    id: nextId++,
    at: Date.now(),
    kind: entry.kind,
    method: entry.method,
    path: entry.path,
    model: entry.model ?? null,
    clientTotalMs: null,
    upstreamUrl: null,
    sentHeaders: null,
    upstreamStatus: null,
    upstreamMs: null,
    responseHeaders: null,
    done: false,
    ok: false,
    error: null,
    usage: null,
    eventCount: null,
    preview: null,
    redirectChain: null,
  };
  traces = [...traces, trace];
  if (traces.length > MAX_TRACES) traces = traces.slice(traces.length - MAX_TRACES);
  emit();
  return trace;
}

/**
 * Fill in what came back, by trace id. Unknown ids are ignored (cleared store).
 */
export function completeTrace(
  id: number,
  result: CompleteTraceInput,
): void {
  patchTrace(id, { ...result, done: true });
}

export interface CompleteTraceInput {
  clientTotalMs: number;
  upstreamUrl?: string | null;
  sentHeaders?: Record<string, string> | null;
  upstreamStatus?: number | null;
  upstreamMs?: number | null;
  responseHeaders?: Record<string, string> | null;
  ok?: boolean;
  error?: ApiError | null;
  usage?: Usage | null;
  eventCount?: number | null;
  preview?: string | null;
  redirectChain?: RedirectHop[] | null;
}

/**
 * Merge partial facts into a trace without closing it — used by streamed
 * requests, which learn their resolved URL at the `open` envelope but only
 * finish at the `done` envelope.
 */
export function patchTrace(id: number, patch: Partial<RequestTrace>): void {
  let changed = false;
  traces = traces.map((t) => {
    if (t.id !== id) return t;
    changed = true;
    return { ...t, ...patch };
  });
  if (changed) emit();
}

/**
 * The two-leg timing a reader wants: how long the browser↔app leg took versus
 * the app↔provider leg. The first is the difference between the client total
 * and the server-measured upstream time (the route's own overhead plus network
 * to the app); the second is reported by the route itself.
 */
export function legBreakdown(t: RequestTrace): { appLegMs: number | null; upstreamLegMs: number | null } {
  if (t.clientTotalMs === null) return { appLegMs: null, upstreamLegMs: t.upstreamMs ?? null };
  if (t.upstreamMs === null || t.upstreamMs === undefined) return { appLegMs: null, upstreamLegMs: null };
  const appLeg = Math.max(0, t.clientTotalMs - t.upstreamMs);
  return { appLegMs: appLeg, upstreamLegMs: t.upstreamMs };
}

/** The host of the resolved upstream URL, or null when it never resolved. */
export function upstreamHost(t: RequestTrace): string | null {
  if (!t.upstreamUrl) return null;
  try {
    return new URL(t.upstreamUrl).host;
  } catch {
    return null;
  }
}
