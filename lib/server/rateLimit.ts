/**
 * Fixed-window rate limit, in memory.
 *
 * The proxy routes make an outbound request per call, so an unthrottled public
 * deployment is a free traffic amplifier — and the bill lands on whoever hosts
 * this. A per-IP window is the cheapest thing that stops that.
 *
 * In memory means per instance: behind several nodes or on serverless the
 * effective limit is the stated one times the instance count. That is a
 * deliberate trade — no dependency, no store to run — and enough for a
 * single-node community deployment. Swap in a shared store before scaling out.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
/** Stop the map from growing without bound if a deployment sees many IPs. */
const MAX_TRACKED = 5_000;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function sweep(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

/** Best-effort client identity: the first hop in x-forwarded-for, else a shared bucket. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

export function checkRateLimit(
  request: Request,
  opts: { max?: number; windowMs?: number } = {},
): RateLimitVerdict {
  const max = opts.max ?? MAX_PER_WINDOW;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const limit = { allowed: true, remaining: max - 1, retryAfterSec: 0, limit: max };
  if (process.env.DISABLE_RATE_LIMIT === '1') return limit;

  const now = Date.now();
  const key = clientKey(request);
  if (windows.size > MAX_TRACKED) sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return limit;
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      limit: max,
    };
  }
  return { allowed: true, remaining: max - existing.count, retryAfterSec: 0, limit: max };
}

export function rateLimitHeaders(v: RateLimitVerdict): Record<string, string> {
  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(v.limit),
    'x-ratelimit-remaining': String(Math.max(0, v.remaining)),
  };
  if (!v.allowed) headers['retry-after'] = String(v.retryAfterSec);
  return headers;
}

/** Test seam — the window map is module state and outlives a single test. */
export function resetRateLimits(): void {
  windows.clear();
}
