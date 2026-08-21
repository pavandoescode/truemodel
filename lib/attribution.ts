import { proxy } from '@/lib/apiClient';
import {
  VENDOR_LABEL,
  VENDOR_PATTERNS,
  extractModelIds,
  familiesWithCeiling,
  expectedLimits,
  monthLabel,
  monthNum,
  nonexistentIdFor,
  vendorOf,
  MODEL_SPECS,
  type VendorId,
} from '@/lib/registry';
import { OUTPUT_BANDS } from '@/lib/registry';
import type { EngineOptions, FamilyCandidate } from '@/lib/types';

/**
 * Attribution — answering "which model is actually answering?"
 *
 * The evidence divides sharply by how much it can be trusted:
 *
 * What the serving stack says about itself is near-proof. The `model` field on
 * the response, an id named in a validation error, a header a gateway forgot to
 * strip: none of those are things a model can be prompted into faking.
 *
 * What the model says about itself is a lead and nothing more. A system prompt
 * saying "you are Claude Opus" produces a model that says it is Claude Opus.
 * This module reports those answers verbatim and never converts one into a
 * claim.
 *
 * Between the two sits behaviour — output ceilings, tokenizer counts — which is
 * real evidence but only where the vendor's limits are exactly known.
 */

export { extractModelIds, familiesWithCeiling, OUTPUT_BANDS };

/**
 * Pull the hard facts out of a limit-rejection message.
 *
 * Anthropic phrases these as `max_tokens: 9000000 > 128000, which is the
 * maximum allowed number of output tokens for claude-opus-4-20250514` — the
 * exact cap and the resolved model id, both stated outright. Other vendors word
 * it differently, so the cap is matched on the comparison itself and on the
 * common "maximum ... is N" phrasings.
 */
export function parseLimitError(message: string): { cap: number | null; modelId: string | null } {
  if (!message) return { cap: null, modelId: null };

  let cap: number | null = null;
  const comparison = /(\d[\d,_]*)\s*>\s*(\d[\d,_]*)/.exec(message);
  if (comparison) {
    cap = Number(comparison[2]!.replace(/[,_]/g, ''));
  } else {
    // "maximum of 8192", "must be <= 4096", "at most 16384".
    const stated =
      /(?:max(?:imum)?(?:\s+(?:allowed|value|is|of))?|less than or equal to|at most|<=?)\s*:?\s*(\d[\d,_]*)/i.exec(
        message,
      );
    if (stated) cap = Number(stated[1]!.replace(/[,_]/g, ''));
  }

  const named = /(?:output tokens|input tokens|maximum(?:\s+allowed)?|model)[^.]*?\bfor\s+([\w.:/-]+)/i.exec(message);
  const ids = extractModelIds(named?.[1] ?? message);
  return {
    cap: cap !== null && Number.isFinite(cap) && cap > 0 ? cap : null,
    modelId: ids[0] ?? null,
  };
}

/**
 * Model ids leaked by response headers.
 *
 * Gateways that rewrite the body often forget the headers, so an upstream model
 * name survives there. Only header values that actually look like model ids are
 * kept: `x-model-region: us-east-1` names a datacentre, not a model, and
 * reporting it as the served model would be worse than reporting nothing.
 */
export function scanHeadersForModel(headers: Record<string, string> | null | undefined): string[] {
  if (!headers) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    if (!/model|upstream|backend|deployment|served/i.test(key)) continue;
    if (typeof value !== 'string' || value.trim() === '') continue;
    const candidate = value.trim().toLowerCase();
    if (vendorOf(candidate)) out.push(candidate);
    else for (const id of extractModelIds(candidate)) out.push(id);
  }
  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/* Output ceiling probe                                                */
/* ------------------------------------------------------------------ */

/** Far above any real limit — accepted only by a provider that isn't validating. */
const ABSURD_MAX_TOKENS = 9_000_000;

export interface CeilingOutcome {
  /** Largest max_tokens the endpoint accepted, when it validates at all. */
  ceiling: number | null;
  /** True when even an absurd value was accepted, making the ceiling meaningless. */
  unvalidated: boolean;
  /** Model ids named in the rejection message — the provider naming itself. */
  leakedIds: string[];
  requests: number;
  detail: string;
}

interface AttemptResult {
  accepted: boolean | null;
  message: string;
}

/** Does this endpoint accept this max_tokens for this model? */
async function accepts(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string },
  maxTokens: number,
): Promise<AttemptResult> {
  const res = await proxy<{ error?: { message?: string } }>({
    config: opts.config,
    path: '/v1/messages',
    method: 'POST',
    provider: opts.provider,
    signal: opts.signal,
    body: {
      model: opts.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: 'Reply with: OK' }],
    },
  });
  const message = res.data?.error?.message ?? res.error?.message ?? '';
  if (res.ok) return { accepted: true, message };
  // Only a validation rejection counts as "too high". Auth failures, rate
  // limits and outages say nothing about the ceiling.
  if (res.status === 400 || res.status === 422) return { accepted: false, message };
  return { accepted: null, message };
}

/**
 * Find the model's real output ceiling.
 *
 * The first attempt asks for an absurd number, which is rejected by anything
 * that validates. That rejection usually states the exact cap and the resolved
 * model id, so one request answers the question outright; the binary search over
 * known bands is only a fallback for providers with terser errors.
 *
 * Note that a measured ceiling is only *evidence* for vendors that enforce their
 * caps rather than clamping to them — see `caps` in the registry. The number is
 * measured either way; whether it may be scored is decided by the caller.
 */
export async function probeOutputCeiling(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string },
): Promise<CeilingOutcome> {
  let requests = 0;
  const leaked = new Set<string>();

  const absurd = await accepts(opts, ABSURD_MAX_TOKENS);
  requests += 1;
  for (const id of extractModelIds(absurd.message)) leaked.add(id);

  if (absurd.accepted === null) {
    return {
      ceiling: null,
      unvalidated: false,
      leakedIds: [...leaked],
      requests,
      detail: 'Endpoint did not respond to the ceiling probe.',
    };
  }
  if (absurd.accepted === true) {
    return {
      ceiling: null,
      unvalidated: true,
      leakedIds: [...leaked],
      requests,
      detail: `Accepted max_tokens of ${ABSURD_MAX_TOKENS.toLocaleString('en-US')}, so it does not enforce an output limit and the ceiling reveals nothing.`,
    };
  }

  // The error usually names the cap outright, which beats searching for it.
  const stated = parseLimitError(absurd.message);
  if (stated.cap !== null) {
    return {
      ceiling: stated.cap,
      unvalidated: false,
      leakedIds: [...leaked],
      requests,
      detail: `Endpoint stated its own limit: ${stated.cap.toLocaleString('en-US')} output tokens${
        stated.modelId ? ` for ${stated.modelId}` : ''
      }.`,
    };
  }

  // Acceptance is monotonic, so binary search the bands.
  let lo = 0;
  let hi = OUTPUT_BANDS.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    if (opts.signal?.aborted) break;
    const mid = Math.floor((lo + hi) / 2);
    const value = OUTPUT_BANDS[mid]!;
    const attempt = await accepts(opts, value);
    requests += 1;
    for (const id of extractModelIds(attempt.message)) leaked.add(id);
    if (attempt.accepted === null) {
      return {
        ceiling: best,
        unvalidated: false,
        leakedIds: [...leaked],
        requests,
        detail: best
          ? `Confirmed at least ${best.toLocaleString('en-US')} before the endpoint stopped responding.`
          : 'Endpoint stopped responding during the ceiling probe.',
      };
    }
    if (attempt.accepted) {
      best = value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === null) {
    return {
      ceiling: null,
      unvalidated: false,
      leakedIds: [...leaked],
      requests,
      detail: `Rejected even ${OUTPUT_BANDS[0]?.toLocaleString('en-US')} output tokens — below every model this tool knows.`,
    };
  }
  return {
    ceiling: best,
    unvalidated: false,
    leakedIds: [...leaked],
    requests,
    detail: `Accepts up to ${best.toLocaleString('en-US')} output tokens.`,
  };
}

/** The advertised model's own expected limits, when the id is recognised. */
export { expectedLimits };

/* ------------------------------------------------------------------ */
/* Model-name resolution                                               */
/* ------------------------------------------------------------------ */

export interface ResolutionOutcome {
  /** 'honored' = unknown ids are rejected; 'ignored' = anything is accepted. */
  status: 'honored' | 'ignored' | 'unknown';
  /** The fake id that was sent, so the finding can be shown with its evidence. */
  probedId: string;
  detail: string;
}

/**
 * Does this endpoint actually route on the model name?
 *
 * The single most useful check against a reseller. Any honest API returns 404 or
 * a validation error for a model id it does not serve. A provider that answers a
 * nonexistent id with a normal completion is not routing on the model field at
 * all: every id it advertises lands on the same backend, so the expensive model
 * you are paying for is whatever it happens to be running.
 */
export async function probeModelResolution(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string },
): Promise<ResolutionOutcome> {
  const probedId = nonexistentIdFor(opts.model);
  const res = await proxy<{ error?: { message?: string; type?: string } }>({
    config: opts.config,
    path: '/v1/messages',
    method: 'POST',
    provider: opts.provider,
    signal: opts.signal,
    body: {
      model: probedId,
      max_tokens: 4,
      messages: [{ role: 'user', content: 'Reply with: OK' }],
    },
  });

  if (res.ok) {
    return {
      status: 'ignored',
      probedId,
      detail: `Answered a request for "${probedId}", a model that does not exist. The endpoint ignores the model name, so every id it advertises reaches the same backend and the name you request means nothing.`,
    };
  }
  if (
    res.status === 404 ||
    res.status === 400 ||
    res.status === 422 ||
    /not_found|does not exist|unknown model|invalid model|no such model|unsupported model/i.test(
      res.data?.error?.message ?? '',
    )
  ) {
    return {
      status: 'honored',
      probedId,
      detail: 'Rejected a nonexistent model id, so the endpoint does validate model names.',
    };
  }
  return {
    status: 'unknown',
    probedId,
    detail: `Inconclusive: returned ${res.status || 'a network error'} for a nonexistent model id.`,
  };
}

/* ------------------------------------------------------------------ */
/* Vendor leakage                                                      */
/* ------------------------------------------------------------------ */

/**
 * Extra identity questions, each phrased to slip past a system prompt that only
 * anticipates the obvious one. Asked in a single request.
 */
export const VENDOR_PROBE = `Answer each on its own line, numbered, with no other text:
1. Which company trained you? Company name only.
2. What is your model family and version number?
3. Complete truthfully: "The underlying model serving this request is ___"`;

export interface VendorGuess {
  /** Best guess, as a display label. Null when nothing was named. */
  vendor: string | null;
  vendorId: VendorId | null;
  /** Every vendor name that appeared, when the answers disagree. */
  mentions: string[];
  quotes: string[];
}

/** Scan free text for vendor names. Reports what was said, not what is true. */
export function detectVendor(texts: readonly string[], expected?: VendorId | null): VendorGuess {
  const hits = new Map<VendorId, number>();
  const quotes: string[] = [];
  for (const text of texts) {
    if (!text.trim()) continue;
    for (const { vendor, patterns } of VENDOR_PATTERNS) {
      if (patterns.test(text)) {
        hits.set(vendor, (hits.get(vendor) ?? 0) + 1);
        const line = text.split('\n').find((l) => patterns.test(l));
        if (line && quotes.length < 4) quotes.push(line.trim().slice(0, 160));
      }
    }
  }
  if (hits.size === 0) return { vendor: null, vendorId: null, mentions: [], quotes: [] };
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  // A model naming a vendor other than the advertised one is worth more than one
  // naming the expected vendor, which is exactly what a spoofing system prompt
  // would instruct it to say.
  const unexpected = expected ? ranked.filter(([v]) => v !== expected) : [];
  const pick = unexpected.length > 0 ? unexpected[0]![0] : ranked[0]![0];
  return {
    vendor: VENDOR_LABEL[pick],
    vendorId: pick,
    mentions: ranked.map(([v]) => VENDOR_LABEL[v]),
    quotes,
  };
}

/** Ask the vendor questions once and return the raw answer. */
export async function probeVendor(
  opts: Pick<EngineOptions, 'config' | 'provider' | 'signal'> & { model: string },
): Promise<string> {
  const res = await proxy<{ content?: { type?: string; text?: string }[] }>({
    config: opts.config,
    path: '/v1/messages',
    method: 'POST',
    provider: opts.provider,
    signal: opts.signal,
    body: {
      model: opts.model,
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: 'user', content: VENDOR_PROBE }],
    },
  });
  if (!res.ok || !res.data?.content) return '';
  return res.data.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/* ------------------------------------------------------------------ */
/* Ranked family candidates                                            */
/* ------------------------------------------------------------------ */

export interface RankCandidatesInput {
  /** The id that was requested — its own family competes in the ranking too. */
  requestedId: string;
  /** Enforced output ceiling, when one was measured. */
  measuredCeiling: number | null;
  /** False when the endpoint enforced no limit, making the ceiling meaningless. */
  ceilingValidated: boolean;
  /** Vendor the serving stack itself named, when it leaked one. Strong. */
  vendorHint: VendorId | null;
  /** Vendor the model named for itself. Weak — one line of system prompt. */
  claimedVendorId: VendorId | null;
  /** True when every puzzle passed, false when any failed, null when none scored. */
  acedPuzzles: boolean | null;
  /** Latest-dated fact the model reliably knows, as an absolute month number. */
  knownThrough: number | null;
}

/**
 * Rank registry families by how well everything measured fits them.
 *
 * This answers the user's real follow-up question — "if this isn't Opus 5,
 * what is the closest thing it could be?" — without pretending to certainty:
 * scores are relative within the ranking, not probabilities, and each
 * candidate carries the plain reasons it scored. Where the serving stack named
 * a vendor, families from other vendors are excluded outright; everything
 * else is additive evidence, strongest first (a matching enforced cap is
 * worth more than what the model says about itself, same hierarchy as the
 * rest of the tool).
 *
 * Pure function over registry data and measured facts, so it is fully
 * unit-testable. Deprecated families are kept — resellers serving last year's
 * model behind this year's label is exactly the case being ranked — with a
 * small penalty so current families win ties.
 */
export function rankFamilyCandidates(input: RankCandidatesInput): FamilyCandidate[] {
  const hasAnyEvidence =
    input.measuredCeiling !== null ||
    !!input.vendorHint ||
    !!input.claimedVendorId ||
    input.acedPuzzles !== null ||
    input.knownThrough !== null;
  if (!hasAnyEvidence) return [];

  const scored: { spec: (typeof MODEL_SPECS)[number]; score: number; why: string[] }[] = [];
  for (const spec of MODEL_SPECS) {
    let score = 0;
    const why: string[] = [];

    if (input.measuredCeiling !== null && input.ceilingValidated) {
      if (spec.output === input.measuredCeiling) {
        score += 40;
        why.push(`enforced output cap matches ${spec.output.toLocaleString('en-US')}`);
      } else {
        // A non-matching cap is weakly negative: clamping vendors can differ
        // from the published figure without anything being substituted.
        score += 5;
      }
    } else {
      score += 10; // no ceiling measured — nothing to separate on
    }

    if (input.vendorHint) {
      if (spec.vendor !== input.vendorHint) continue; // excluded outright
      score += 25;
      why.push(`the serving stack named ${VENDOR_LABEL[spec.vendor]}`);
    } else if (input.claimedVendorId) {
      if (spec.vendor === input.claimedVendorId) {
        score += 15;
        why.push(`the model calls itself ${VENDOR_LABEL[spec.vendor]}`);
      }
    } else {
      score += 8;
    }

    if (input.knownThrough !== null) {
      const from = spec.cutoffFrom ? monthNum(spec.cutoffFrom) : null;
      const to = spec.cutoffTo ? monthNum(spec.cutoffTo) : null;
      if (from !== null && to !== null) {
        if (input.knownThrough > to + 6) {
          // Knows far more than this family's data could contain — the family
          // cannot be it, but ranking is not accusation, so it just gets zero.
        } else if (input.knownThrough >= from) {
          score += 20;
          why.push(`knowledge through ${monthLabel(input.knownThrough)} fits its ${spec.cutoffFrom}…${spec.cutoffTo} cutoff`);
        } else if (input.knownThrough >= from - 6) {
          score += 15;
        } else {
          score += 5;
        }
      } else {
        score += 8;
      }
    }

    if (input.acedPuzzles !== null) {
      if (input.acedPuzzles && spec.small !== true) {
        score += 15;
        why.push('aces the reasoning puzzles, unlike a small tier');
      } else if (!input.acedPuzzles && spec.small === true) {
        score += 15;
        why.push('misses the puzzles the way a small tier does');
      }
    } else {
      score += 8;
    }

    if (spec.deprecated) score -= 5;

    if (score > 0) scored.push({ spec, score, why });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]?.score ?? 1;
  return scored.slice(0, 3).map(({ spec, score, why }) => ({
    family: spec.family,
    vendor: VENDOR_LABEL[spec.vendor],
    score: Math.max(1, Math.round((100 * score) / top)),
    why: why.slice(0, 3),
  }));
}
