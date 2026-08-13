import { NextResponse } from 'next/server';
import { classifyError } from '@/lib/errors';
import { assertPublicTarget } from '@/lib/server/guard';
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rateLimit';
import { ConfigError, buildUrl, collectHeaders, parseWireConfig, timedFetch } from '@/lib/server/upstream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface PingResult {
  reachable: boolean;
  latencyMs: number;
  status: number | null;
  headers: Record<string, string>;
  url: string;
  message: string;
}

/**
 * Unauthenticated reachability probe. Any HTTP response — including 401 or
 * 404 — proves the host is up, which separates "endpoint wrong" from
 * "key wrong" in the connection test.
 */
export async function POST(request: Request) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      {
        reachable: false,
        latencyMs: 0,
        status: null,
        headers: {},
        url: '',
        message: `Too many requests. Try again in ${rate.retryAfterSec}s.`,
      } satisfies PingResult,
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const config = parseWireConfig(payload.config);
    const url = buildUrl(config.endpoint, typeof payload.path === 'string' ? payload.path : '/');
    const timeoutMs = Math.min(Number(payload.timeoutMs) || 15_000, 60_000);

    await assertPublicTarget(url);

    const outcome = await timedFetch(url, { method: 'GET', headers: { accept: '*/*' } }, timeoutMs);

    if (!outcome.response) {
      return NextResponse.json(
        {
          reachable: false,
          latencyMs: outcome.latencyMs,
          status: null,
          headers: {},
          url,
          message: outcome.networkError?.message ?? 'Host unreachable',
        } satisfies PingResult,
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        reachable: true,
        latencyMs: outcome.latencyMs,
        status: outcome.response.status,
        headers: collectHeaders(outcome.response.headers),
        url,
        message: `Host responded with ${outcome.response.status}`,
      } satisfies PingResult,
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        reachable: false,
        latencyMs: 0,
        status: null,
        headers: {},
        url: '',
        message,
        error: classifyError({ status: null, message }),
      },
      { status: err instanceof ConfigError ? 400 : 500 },
    );
  }
}
