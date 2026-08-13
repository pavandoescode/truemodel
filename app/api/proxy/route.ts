import { NextResponse } from 'next/server';
import { classifyError } from '@/lib/errors';
import { assertPublicTarget } from '@/lib/server/guard';
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rateLimit';
import {
  ConfigError,
  buildUpstreamHeaders,
  buildUrl,
  collectHeaders,
  maskHeaders,
  parseWireConfig,
  safeJson,
  timedFetch,
} from '@/lib/server/upstream';
import type { ProxyResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TIMEOUT = 300_000;
const DEFAULT_TIMEOUT = 60_000;

/**
 * Server-side proxy for every non-streaming provider call. Keys never reach a
 * third party from the browser, and this side-steps provider CORS entirely.
 */
export async function POST(request: Request) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      fail(429, `Too many requests. Try again in ${rate.retryAfterSec}s.`),
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(fail(0, 'Request body was not valid JSON.'), { status: 400 });
  }

  let url = '';
  let sentHeaders: Record<string, string> = {};
  try {
    const config = parseWireConfig(payload.config);
    const path = typeof payload.path === 'string' && payload.path ? payload.path : '/v1/models';
    const method = payload.method === 'POST' ? 'POST' : 'GET';
    const timeoutMs = Math.min(Number(payload.timeoutMs) || DEFAULT_TIMEOUT, MAX_TIMEOUT);
    const query = (payload.query as Record<string, string> | undefined) ?? undefined;

    url = buildUrl(config.endpoint, path, query);
    await assertPublicTarget(url);
    const headers = buildUpstreamHeaders(config, { json: method === 'POST' });
    sentHeaders = maskHeaders(headers);

    const outcome = await timedFetch(
      url,
      { method, headers, body: method === 'POST' ? JSON.stringify(payload.body ?? {}) : undefined },
      timeoutMs,
    );

    if (!outcome.response) {
      const message = outcome.networkError?.message ?? 'Request failed';
      const error = classifyError({
        status: null,
        message,
        provider: (payload.provider as never) ?? null,
      });
      if (outcome.timedOut) error.category = 'timeout';
      return NextResponse.json(
        {
          ok: false,
          status: 0,
          statusText: outcome.timedOut ? 'Timeout' : 'Network Error',
          latencyMs: outcome.latencyMs,
          headers: {},
          data: null,
          rawText: '',
          error,
          url,
          sentHeaders,
        } satisfies ProxyResponse,
        { status: 200 },
      );
    }

    const res = outcome.response;
    const rawText = await res.text();
    const parsed = safeJson(rawText);
    const responseHeaders = collectHeaders(res.headers);

    const error = !res.ok
      ? classifyError({
          status: res.status,
          body: parsed.data,
          rawText,
          provider: (payload.provider as never) ?? null,
        })
      : !parsed.ok && rawText.trim()
        ? classifyError({ status: res.status, message: 'Response was not valid JSON.', rawText })
        : null;

    const body: ProxyResponse = {
      ok: res.ok && parsed.ok,
      status: res.status,
      statusText: res.statusText,
      latencyMs: outcome.latencyMs,
      headers: responseHeaders,
      data: parsed.data,
      rawText,
      error,
      url,
      sentHeaders,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof ConfigError ? 400 : 500;
    return NextResponse.json(
      { ...fail(0, message), url, sentHeaders, error: classifyError({ status: null, message }) },
      { status },
    );
  }
}

function fail(status: number, message: string): ProxyResponse {
  return {
    ok: false,
    status,
    statusText: 'Error',
    latencyMs: 0,
    headers: {},
    data: null,
    rawText: '',
    error: classifyError({ status: null, message }),
    url: '',
    sentHeaders: {},
  };
}
