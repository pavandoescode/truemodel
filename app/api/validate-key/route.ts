import { NextRequest, NextResponse } from 'next/server';
import { normalizeModels, pickDefaultModel } from '@/lib/models';
import { assertPublicTarget } from '@/lib/server/guard';
import { checkRateLimit, rateLimitHeaders } from '@/lib/server/rateLimit';
import { ConfigError } from '@/lib/server/upstream';

export const runtime = 'nodejs';

/**
 * Used only when an endpoint publishes no catalogue and the caller named no
 * model. Cheap on purpose — this request exists to check a key, not to test a
 * model, and every Anthropic-shaped reseller accepts this id.
 */
const LAST_RESORT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Ask the endpoint what it serves, so a key can be validated without assuming
 * whose models are behind it. A fixed default id would fail every provider that
 * does not resell that one vendor.
 */
async function discoverModel(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<string | null> {
  for (const path of ['/v1/models', '/models']) {
    // An endpoint already ending in /v1 would otherwise be asked for
    // /v1/v1/models, which 404s and wastes a round trip.
    const suffix = /\/v1$/i.test(baseUrl) && path.startsWith('/v1') ? path.slice(3) : path;
    try {
      const res = await fetch(`${baseUrl}${suffix}`, { method: 'GET', headers });
      if (!res.ok) continue;
      const picked = pickDefaultModel(normalizeModels(await res.json()));
      if (picked) return picked;
    } catch {
      /* try the next path */
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json(
      { valid: false, error: `Too many requests. Try again in ${rate.retryAfterSec}s.` },
      { status: 429, headers: rateLimitHeaders(rate) },
    );
  }

  try {
    const body = await request.json();
    const { apiKey, endpoint = 'https://api.anthropic.com', model } = body;

    if (!apiKey || typeof apiKey !== 'string') {
      return NextResponse.json(
        { valid: false, error: 'API key is required' },
        { status: 400 }
      );
    }

    if (!endpoint || typeof endpoint !== 'string') {
      return NextResponse.json(
        { valid: false, error: 'Endpoint is required' },
        { status: 400 }
      );
    }

    let cleanEndpoint = endpoint.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(cleanEndpoint)) {
      cleanEndpoint = `https://${cleanEndpoint}`;
    }

    const targetUrl = cleanEndpoint.endsWith('/v1')
      ? `${cleanEndpoint}/messages`
      : `${cleanEndpoint}/v1/messages`;

    // Refuse to fetch anything only this server can reach (see lib/server/guard.ts).
    try {
      await assertPublicTarget(targetUrl);
    } catch (err) {
      if (err instanceof ConfigError) {
        return NextResponse.json({ valid: false, error: err.message }, { status: 400 });
      }
      throw err;
    }

    const commonHeaders = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };

    // A key is validated against whatever this endpoint actually sells. Only if
    // it publishes no catalogue at all do we fall back to a cheap well-known id.
    let resolvedModel = typeof model === 'string' && model.trim() ? model.trim() : '';
    let discovered = false;
    if (!resolvedModel) {
      const found =
        (await discoverModel(cleanEndpoint, { ...commonHeaders, 'x-api-key': apiKey })) ??
        (await discoverModel(cleanEndpoint, { ...commonHeaders, Authorization: `Bearer ${apiKey}` }));
      discovered = found !== null;
      resolvedModel = found ?? LAST_RESORT_MODEL;
    }

    const testBody = JSON.stringify({
      model: resolvedModel,
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: 'Say "ok"',
        },
      ],
    });

    // Try one auth style at a time. Sending `x-api-key` and `Authorization`
    // together is rejected outright by gateways that treat conflicting auth
    // headers as a bad request, so probe the Anthropic style first and only
    // fall back to Bearer if the key is refused.
    const attempt = (authHeader: Record<string, string>) =>
      fetch(targetUrl, {
        method: 'POST',
        headers: {
          ...commonHeaders,
          ...authHeader,
        },
        body: testBody,
      });

    let testResponse = await attempt({ 'x-api-key': apiKey });
    if (testResponse.status === 401 || testResponse.status === 403) {
      testResponse = await attempt({ Authorization: `Bearer ${apiKey}` });
    }

    const rawText = await testResponse.text();
    let responseData: any = null;
    let isHtml = false;

    if (rawText.trim().startsWith('<')) {
      isHtml = true;
    } else {
      try {
        responseData = JSON.parse(rawText);
      } catch {
        responseData = null;
      }
    }

    if (testResponse.ok) {
      return NextResponse.json({
        valid: true,
        message: discovered
          ? `API key is valid — tested against ${resolvedModel}, discovered from this endpoint's own model list`
          : 'API key is valid',
        model: resolvedModel,
        modelSource: typeof model === 'string' && model.trim() ? 'requested' : discovered ? 'discovered' : 'fallback',
        provider: cleanEndpoint.includes('anthropic') ? 'anthropic' : 'custom',
      });
    }

    if (isHtml) {
      const errorMsg =
        testResponse.status === 404
          ? 'Endpoint not found (404). Server returned an HTML web page instead of API JSON. Check your API base URL.'
          : `Server returned an HTML error page (Status ${testResponse.status}).`;
      return NextResponse.json(
        {
          valid: false,
          error: errorMsg,
          status: testResponse.status,
        },
        { status: 400 }
      );
    }

    // Check for specific error patterns
    const errorMessage = responseData?.error?.message || responseData?.message || testResponse.statusText || 'Unknown error';

    if (testResponse.status === 401 || String(errorMessage).toLowerCase().includes('unauthorized') || String(errorMessage).toLowerCase().includes('invalid api key')) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Invalid API key. Please check and try again.',
          status: 401,
        },
        { status: 400 }
      );
    }

    if (testResponse.status === 429) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Rate limit exceeded. Please try again later.',
          status: 429,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        valid: false,
        error: errorMessage || 'Failed to validate API key',
        status: testResponse.status,
      },
      { status: 400 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        valid: false,
        error: `Connection failed: ${message}`,
      },
      { status: 500 }
    );
  }
}
