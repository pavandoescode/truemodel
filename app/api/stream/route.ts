import { classifyError } from '@/lib/errors';
import { SseAccumulator, ndjson } from '@/lib/server/sse';
import { assertPublicTarget } from '@/lib/server/guard';
import { checkRateLimit } from '@/lib/server/rateLimit';
import {
  buildUpstreamHeaders,
  buildUrl,
  collectHeaders,
  maskHeaders,
  parseWireConfig,
  safeJson,
  timedFetch,
} from '@/lib/server/upstream';
import type { ProviderId } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streaming proxy. Upstream SSE is re-emitted as NDJSON envelopes so the
 * browser can measure TTFT itself and render deltas as they land.
 */
export async function POST(request: Request) {
  // Streaming holds a connection open per call, so it gets a tighter window
  // than /api/proxy. The refusal still comes back as NDJSON — the client only
  // knows how to read envelopes, and a bare 429 body would surface as
  // "stream had no body" instead of the real reason.
  const rate = checkRateLimit(request, { max: 30 });
  if (!rate.allowed) {
    return errorStream(
      classifyError({
        status: 429,
        message: `Too many requests. Try again in ${rate.retryAfterSec}s.`,
      }),
      { status: 429 },
    );
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorStream(classifyError({ status: null, message: 'Request body was not valid JSON.' }));
  }

  const provider = (payload.provider as ProviderId | null) ?? null;
  let url = '';
  let sentHeaders: Record<string, string> = {};
  let upstreamHeaders: Record<string, string> = {};

  try {
    const config = parseWireConfig(payload.config);
    const path = typeof payload.path === 'string' && payload.path ? payload.path : '/v1/messages';
    const timeoutMs = Math.min(Number(payload.timeoutMs) || 120_000, 300_000);
    url = buildUrl(config.endpoint, path);
    await assertPublicTarget(url);
    upstreamHeaders = { ...buildUpstreamHeaders(config, { json: true }), accept: 'text/event-stream' };
    sentHeaders = maskHeaders(upstreamHeaders);

    const body = { ...(payload.body as Record<string, unknown>), stream: true };
    const started = Date.now();
    const outcome = await timedFetch(
      url,
      { method: 'POST', headers: upstreamHeaders, body: JSON.stringify(body) },
      timeoutMs,
      // Re-validate every redirect hop, not just the first URL.
      { guard: assertPublicTarget },
    );

    if (!outcome.response) {
      const error = classifyError({ status: null, message: outcome.networkError?.message ?? 'Request failed', provider });
      if (outcome.timedOut) error.category = 'timeout';
      return errorStream(error, { url, sentHeaders, latencyMs: outcome.latencyMs, redirects: outcome.redirects });
    }

    const res = outcome.response;
    const responseHeaders = collectHeaders(res.headers);

    if (!res.ok || !res.body) {
      const rawText = res.body ? await res.text() : '';
      const parsed = safeJson(rawText);
      const error = classifyError({ status: res.status, body: parsed.data, rawText, provider });
      return errorStream(error, {
        url,
        sentHeaders,
        status: res.status,
        headers: responseHeaders,
        latencyMs: Date.now() - started,
        redirects: outcome.redirects,
      });
    }

    const upstream = res.body;
    let controllerClosed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const acc = new SseAccumulator();
        const push = (line: string) => {
          if (!controllerClosed) controller.enqueue(encoder.encode(line));
        };

        push(
          ndjson({
            type: 'open',
            status: res.status,
            headers: responseHeaders,
            url,
            sentHeaders,
            redirects: outcome.redirects,
          }),
        );

        const reader = upstream.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const env of acc.feed(decoder.decode(value, { stream: true }))) push(ndjson(env));
          }
          for (const env of acc.finish()) push(ndjson(env));
        } catch (err) {
          if (!controllerClosed) {
            push(
              ndjson({
                type: 'error',
                error: classifyError({
                  status: null,
                  message: err instanceof Error ? err.message : String(err),
                  provider,
                }),
              }),
            );
          }
        } finally {
          if (!controllerClosed) {
            push(
              ndjson({
                type: 'done',
                usage: acc.usage,
                stopReason: acc.stopReason,
                latencyMs: Date.now() - started,
                eventCount: acc.eventCount,
              }),
            );
            controllerClosed = true;
            controller.close();
          }
          reader.releaseLock();
        }
      },
      cancel() {
        controllerClosed = true;
        void upstream.cancel();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorStream(classifyError({ status: null, message, provider }), { url, sentHeaders });
  }
}

function errorStream(
  error: ReturnType<typeof classifyError>,
  meta: { url?: string; sentHeaders?: Record<string, string>; status?: number; headers?: Record<string, string>; latencyMs?: number; redirects?: { from: string; to: string; status: number; authDropped?: boolean }[] } = {},
) {
  const lines =
    ndjson({
      type: 'open',
      status: meta.status ?? 0,
      headers: meta.headers ?? {},
      url: meta.url ?? '',
      sentHeaders: meta.sentHeaders ?? {},
      redirects: meta.redirects ?? [],
    }) +
    ndjson({ type: 'error', error }) +
    ndjson({ type: 'done', usage: null, stopReason: null, latencyMs: meta.latencyMs ?? 0, eventCount: 0 });
  return new Response(lines, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}
