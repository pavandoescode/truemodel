import type { RateLimitInfo } from '@/lib/types';

const NUM_KEYS: [keyof RateLimitInfo, string[]][] = [
  ['requestsLimit', ['anthropic-ratelimit-requests-limit', 'x-ratelimit-limit-requests', 'x-ratelimit-limit']],
  [
    'requestsRemaining',
    ['anthropic-ratelimit-requests-remaining', 'x-ratelimit-remaining-requests', 'x-ratelimit-remaining'],
  ],
  ['tokensLimit', ['anthropic-ratelimit-tokens-limit', 'x-ratelimit-limit-tokens']],
  ['tokensRemaining', ['anthropic-ratelimit-tokens-remaining', 'x-ratelimit-remaining-tokens']],
  ['inputTokensLimit', ['anthropic-ratelimit-input-tokens-limit']],
  ['inputTokensRemaining', ['anthropic-ratelimit-input-tokens-remaining']],
  ['outputTokensLimit', ['anthropic-ratelimit-output-tokens-limit']],
  ['outputTokensRemaining', ['anthropic-ratelimit-output-tokens-remaining']],
];

const RESET_KEYS: [keyof RateLimitInfo, string[]][] = [
  ['requestsResetAt', ['anthropic-ratelimit-requests-reset', 'x-ratelimit-reset-requests', 'x-ratelimit-reset']],
  ['tokensResetAt', ['anthropic-ratelimit-tokens-reset', 'x-ratelimit-reset-tokens']],
];

const EMPTY: RateLimitInfo = {
  requestsLimit: null,
  requestsRemaining: null,
  requestsResetAt: null,
  tokensLimit: null,
  tokensRemaining: null,
  tokensResetAt: null,
  inputTokensLimit: null,
  inputTokensRemaining: null,
  outputTokensLimit: null,
  outputTokensRemaining: null,
  retryAfterSeconds: null,
  tier: null,
  present: false,
  raw: {},
};

/** Pull rate-limit signal out of response headers, Anthropic or OpenAI style. */
export function parseRateLimits(headers: Record<string, string> | undefined | null): RateLimitInfo {
  if (!headers) return { ...EMPTY };
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  const info: RateLimitInfo = { ...EMPTY, raw: {} };
  let present = false;

  for (const [field, keys] of NUM_KEYS) {
    for (const key of keys) {
      if (lower[key] === undefined) continue;
      const n = Number(lower[key]);
      if (Number.isFinite(n)) {
        (info as unknown as Record<string, number | null>)[field as string] = n;
        info.raw[key] = lower[key];
        present = true;
        break;
      }
    }
  }

  for (const [field, keys] of RESET_KEYS) {
    for (const key of keys) {
      if (lower[key] === undefined) continue;
      (info as unknown as Record<string, string | null>)[field as string] = lower[key];
      info.raw[key] = lower[key];
      present = true;
      break;
    }
  }

  if (lower['retry-after'] !== undefined) {
    const n = Number(lower['retry-after']);
    info.retryAfterSeconds = Number.isFinite(n) ? n : null;
    info.raw['retry-after'] = lower['retry-after'];
    present = true;
  }

  const tierKey = Object.keys(lower).find((k) => k.includes('ratelimit') && k.includes('tier'));
  if (tierKey) {
    info.tier = lower[tierKey] ?? null;
    info.raw[tierKey] = lower[tierKey]!;
    present = true;
  }

  info.present = present;
  return info;
}

/** Fraction of quota left, 0–1, or null when unknown. */
export function remainingFraction(limit: number | null, remaining: number | null): number | null {
  if (limit === null || remaining === null || limit <= 0) return null;
  return Math.max(0, Math.min(1, remaining / limit));
}

export function healthOf(fraction: number | null): 'pass' | 'partial' | 'fail' | 'skip' {
  if (fraction === null) return 'skip';
  if (fraction > 0.35) return 'pass';
  if (fraction > 0.1) return 'partial';
  return 'fail';
}
