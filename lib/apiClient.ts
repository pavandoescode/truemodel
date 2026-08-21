import { classifyError } from '@/lib/errors';
import { beginTrace, completeTrace, patchTrace } from '@/lib/requestTrace';
import type {
  MessagesRequest,
  MessagesResponse,
  ProviderConfig,
  ProviderId,
  ProxyResponse,
  StreamEnvelope,
  StreamOutcome,
  WireConfig,
} from '@/lib/types';

/** Enough of the response body to recognise it in the trace without flooding the panel. */
const PREVIEW_CHARS = 280;

/** The model id a request body names, for labelling traces. */
function modelOf(body: unknown): string | null {
  return typeof body === 'object' && body !== null && typeof (body as { model?: unknown }).model === 'string'
    ? (body as { model: string }).model
    : null;
}

/** Flatten the editable config into the wire shape our routes expect. */
export function toWireConfig(config: ProviderConfig | WireConfig): WireConfig {
  if (!Array.isArray((config as ProviderConfig).headers)) return config as WireConfig;
  const c = config as ProviderConfig;
  const headers: Record<string, string> = {};
  for (const h of c.headers) {
    if (h.enabled && h.key.trim()) headers[h.key.trim()] = h.value;
  }
  return {
    endpoint: c.endpoint,
    apiKey: c.apiKey,
    headers,
    authStyle: c.authStyle,
    anthropicVersion: c.anthropicVersion,
  };
}

export interface ProxyOptions {
  config: ProviderConfig | WireConfig;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
  provider?: ProviderId | null;
  signal?: AbortSignal;
}

/** Single round trip through our server proxy. Never throws. */
export async function proxy<T = unknown>(opts: ProxyOptions): Promise<ProxyResponse<T>> {
  const started = performance.now();
  const trace = beginTrace({
    kind: 'proxy',
    method: opts.method ?? 'GET',
    path: opts.path,
    model: modelOf(opts.body),
  });
  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        config: toWireConfig(opts.config),
        path: opts.path,
        method: opts.method ?? 'GET',
        body: opts.body,
        query: opts.query,
        timeoutMs: opts.timeoutMs,
        provider: opts.provider ?? null,
      }),
    });
    const json = (await res.json()) as ProxyResponse<T>;
    completeTrace(trace.id, {
      clientTotalMs: Math.round(performance.now() - started),
      upstreamUrl: json.url || null,
      sentHeaders: json.sentHeaders,
      upstreamStatus: json.status,
      upstreamMs: json.latencyMs,
      responseHeaders: json.headers,
      ok: json.ok,
      error: json.error,
      preview: json.rawText ? json.rawText.slice(0, PREVIEW_CHARS) : null,
      redirectChain: json.redirects ?? null,
    });
    return json;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted = err instanceof Error && err.name === 'AbortError';
    completeTrace(trace.id, {
      clientTotalMs: Math.round(performance.now() - started),
      ok: false,
      error: classifyError({ status: null, message: aborted ? 'Cancelled by user.' : message }),
    });
    return {
      ok: false,
      status: 0,
      statusText: aborted ? 'Cancelled' : 'Proxy Error',
      latencyMs: Math.round(performance.now() - started),
      headers: {},
      data: null,
      rawText: '',
      error: classifyError({ status: null, message: aborted ? 'Cancelled by user.' : message }),
      url: '',
      sentHeaders: {},
    };
  }
}

export function sendMessage(
  opts: Omit<ProxyOptions, 'path' | 'method' | 'body'> & { body: MessagesRequest; path?: string },
): Promise<ProxyResponse<MessagesResponse>> {
  return proxy<MessagesResponse>({
    ...opts,
    path: opts.path ?? '/v1/messages',
    method: 'POST',
    body: opts.body,
  });
}

export interface StreamOptions {
  config: ProviderConfig | WireConfig;
  body: MessagesRequest;
  path?: string;
  provider?: ProviderId | null;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (chunk: string, full: string) => void;
  onEvent?: (event: string, data: unknown) => void;
}

/** Consume the NDJSON envelope stream, measuring TTFT client-side. */
export async function streamMessages(opts: StreamOptions): Promise<StreamOutcome> {
  const started = performance.now();
  const path = opts.path ?? '/v1/messages';
  const trace = beginTrace({ kind: 'stream', method: 'POST', path, model: modelOf(opts.body) });
  const outcome: StreamOutcome = {
    ok: false,
    status: 0,
    headers: {},
    sentHeaders: {},
    text: '',
    events: [],
    toolUses: [],
    usage: null,
    stopReason: null,
    ttftMs: null,
    latencyMs: 0,
    eventCount: 0,
    error: null,
  };

  const finishTrace = () => {
    completeTrace(trace.id, {
      clientTotalMs: Math.round(performance.now() - started),
      upstreamMs: outcome.latencyMs || null,
      upstreamStatus: outcome.status || null,
      ok: !outcome.error && outcome.status > 0 && outcome.status < 400,
      error: outcome.error,
      usage: outcome.usage,
      eventCount: outcome.eventCount || null,
      preview: outcome.text ? outcome.text.slice(0, PREVIEW_CHARS) : null,
    });
  };

  try {
    const res = await fetch('/api/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        config: toWireConfig(opts.config),
        path,
        body: { ...opts.body, stream: true },
        timeoutMs: opts.timeoutMs,
        provider: opts.provider ?? null,
      }),
    });

    if (!res.body) {
      outcome.error = classifyError({ status: res.status, message: 'Stream response had no body.' });
      outcome.latencyMs = Math.round(performance.now() - started);
      finishTrace();
      return outcome;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) applyEnvelope(outcome, line, started, opts, trace.id);
      }
    }
    if (buffer.trim()) applyEnvelope(outcome, buffer.trim(), started, opts, trace.id);
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    outcome.error = classifyError({
      status: null,
      message: aborted ? 'Cancelled by user.' : err instanceof Error ? err.message : String(err),
    });
  }

  outcome.latencyMs = outcome.latencyMs || Math.round(performance.now() - started);
  outcome.ok = !outcome.error && outcome.status > 0 && outcome.status < 400;
  finishTrace();
  return outcome;
}

function applyEnvelope(outcome: StreamOutcome, line: string, started: number, opts: StreamOptions, traceId: number) {
  let env: StreamEnvelope;
  try {
    env = JSON.parse(line) as StreamEnvelope;
  } catch {
    return;
  }
  switch (env.type) {
    case 'open':
      outcome.status = env.status;
      outcome.headers = env.headers;
      outcome.sentHeaders = env.sentHeaders;
      // The route names where it actually sent the request — the fact the
      // whole trace panel exists to show.
      patchTrace(traceId, {
        upstreamUrl: env.url || null,
        sentHeaders: env.sentHeaders,
        upstreamStatus: env.status,
        responseHeaders: env.headers,
        redirectChain: env.redirects ?? null,
      });
      break;
    case 'delta':
      if (outcome.ttftMs === null) outcome.ttftMs = Math.round(performance.now() - started);
      outcome.text += env.text;
      opts.onDelta?.(env.text, outcome.text);
      break;
    case 'event':
      outcome.events.push({ event: env.event, data: env.data });
      opts.onEvent?.(env.event, env.data);
      break;
    case 'toolUse':
      outcome.toolUses.push({ id: env.id, name: env.name, input: env.input });
      break;
    case 'error':
      outcome.error = env.error;
      break;
    case 'done':
      outcome.usage = env.usage;
      outcome.stopReason = env.stopReason;
      outcome.latencyMs = env.latencyMs;
      outcome.eventCount = env.eventCount;
      break;
  }
}

export async function ping(config: ProviderConfig | WireConfig, path = '/'): Promise<{
  reachable: boolean;
  latencyMs: number;
  status: number | null;
  headers: Record<string, string>;
  message: string;
  redirects?: { from: string; to: string; status: number; authDropped?: boolean }[];
}> {
  const started = performance.now();
  const trace = beginTrace({ kind: 'ping', method: 'GET', path });
  try {
    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: toWireConfig(config), path }),
    });
    const json = (await res.json()) as {
      reachable: boolean;
      latencyMs: number;
      status: number | null;
      headers: Record<string, string>;
      message: string;
      redirects?: { from: string; to: string; status: number; authDropped?: boolean }[];
    };
    completeTrace(trace.id, {
      clientTotalMs: Math.round(performance.now() - started),
      upstreamMs: json.latencyMs,
      upstreamStatus: json.status,
      responseHeaders: json.headers,
      ok: json.reachable,
      preview: json.message ? json.message.slice(0, PREVIEW_CHARS) : null,
      redirectChain: json.redirects ?? null,
    });
    return json;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    completeTrace(trace.id, {
      clientTotalMs: Math.round(performance.now() - started),
      ok: false,
      error: classifyError({ status: null, message }),
    });
    return {
      reachable: false,
      latencyMs: 0,
      status: null,
      headers: {},
      message,
    };
  }
}
