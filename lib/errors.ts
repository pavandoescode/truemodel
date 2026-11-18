import type { ApiError, ErrorCategory, ProviderId } from '@/lib/types';

const CATEGORY_TITLES: Record<ErrorCategory, string> = {
  auth: 'Authentication failed',
  forbidden: 'Request forbidden',
  'rate-limit': 'Rate limited',
  'invalid-model': 'Model not available',
  'invalid-request': 'Invalid request',
  network: 'Network error',
  timeout: 'Request timed out',
  'malformed-json': 'Malformed response',
  'not-found': 'Endpoint not found',
  server: 'Provider error',
  overloaded: 'Provider overloaded',
  cors: 'Blocked by CORS',
  unknown: 'Unknown error',
};

export const STATUS_EXPLANATIONS: Record<number, string> = {
  400: 'The provider rejected the request body — usually an unsupported field or a bad model id.',
  401: 'The API key was missing, malformed, or rejected.',
  403: 'Refused, not unauthenticated: the key may lack access to this model, or an edge proxy blocked the request before the API saw it.',
  404: 'The path does not exist on this host. An Anthropic-shaped endpoint must accept POST /v1/messages.',
  405: 'The path exists but does not accept this HTTP method.',
  408: 'The provider gave up waiting for the request.',
  413: 'The request body was larger than the provider accepts.',
  422: 'The body parsed but failed validation — check parameter ranges.',
  429: 'Too many requests or tokens for your current quota.',
  500: 'The provider hit an internal error. Retrying usually helps.',
  502: 'A gateway in front of the provider returned an invalid response.',
  503: 'The provider is temporarily unavailable or overloaded.',
  504: 'A gateway upstream of the provider timed out.',
  529: 'Anthropic returns 529 when the API is overloaded.',
};

function categoryFor(status: number | null, providerType: string | null, message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (status === 401) return 'auth';
  // 403 is not an auth failure. Gateways return it for a model the key may not
  // use, and the edge proxy in front of one (openresty, Cloudflare) returns it
  // for requests that never reached the API at all. Telling the user to re-copy
  // a key that just worked on the previous request is the wrong advice.
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate-limit';
  if (status === 404) return 'not-found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 529 || providerType === 'overloaded_error') return 'overloaded';
  if (providerType === 'invalid_request_error' || providerType === 'invalid_request') return 'invalid-request';
  if (providerType === 'authentication_error' || providerType === 'unauthorized') return 'auth';
  if (providerType === 'permission_error' || providerType === 'forbidden') return 'forbidden';
  if (providerType === 'not_found_error' || providerType === 'model_not_found') return 'invalid-model';
  if (providerType === 'rate_limit_error' || providerType === 'rate_limit_exceeded') return 'rate-limit';
  if (status !== null && status >= 500) return 'server';
  if (status === 400 || status === 422 || status === 413) {
    if (/model/.test(m) && /(not found|not exist|unknown|invalid|unsupported|no such)/.test(m)) return 'invalid-model';
    return 'invalid-request';
  }
  if (/timed? ?out|etimedout|abort/.test(m)) return 'timeout';
  if (/econnrefused|enotfound|eai_again|fetch failed|socket|dns|network|certificate|ssl/.test(m)) return 'network';
  if (/cors|cross-origin/.test(m)) return 'cors';
  if (/unexpected token|json/.test(m)) return 'malformed-json';
  return 'unknown';
}

const GENERIC_FIXES: Record<ErrorCategory, string[]> = {
  auth: [
    'Re-copy the key — trailing whitespace and newlines are a common cause.',
    'Confirm the key belongs to this endpoint; keys are not portable between providers.',
    'Check the auth style: Anthropic uses x-api-key, most gateways use Authorization: Bearer.',
  ],
  forbidden: [
    'The key was accepted but this request was refused — check the key is entitled to this model.',
    'An HTML body here means an edge proxy or WAF answered, not the API: the request never reached the model.',
    'Gateways commonly answer 403 for a model id they do not serve — copy an id from the discovered list.',
  ],
  'rate-limit': [
    'Lower the concurrency setting in the batch runner.',
    'Wait for the window in the rate-limit headers to reset, then retry failed models.',
  ],
  'invalid-model': [
    'Run Model Discovery and copy an id straight from the table.',
    'Gateways usually namespace ids, e.g. anthropic/claude-sonnet-4 rather than claude-sonnet-4.',
  ],
  'invalid-request': [
    'Remove provider-specific fields the gateway may not forward (top_k, stop_sequences).',
    'Lower max_tokens below the model output limit.',
  ],
  network: [
    'Confirm the host is reachable from this machine.',
    'For a local gateway, check it is running and listening on the expected port.',
  ],
  timeout: ['Raise the timeout, or try a smaller prompt.', 'Streaming often survives where a long blocking call fails.'],
  'malformed-json': [
    'The provider returned something that is not JSON — inspect the raw response.',
    'A login or captcha page here usually means the path is wrong.',
  ],
  'not-found': [
    'Drop or add a /v1 suffix on the endpoint — this is the single most common mistake.',
    'Some gateways expose Anthropic passthrough at /anthropic instead.',
  ],
  server: ['Retry — this is on the provider side.', 'Check the provider status page if it persists.'],
  overloaded: ['Retry with backoff.', 'Try a smaller or less contended model.'],
  cors: ['Requests are already proxied server-side, so this should not appear — inspect the raw response.'],
  unknown: ['Open the raw response in the inspector for the provider’s own message.'],
};

const PROVIDER_FIXES: Partial<Record<ProviderId, Partial<Record<ErrorCategory, string[]>>>> = {
  openrouter: {
    auth: ['OpenRouter keys start with sk-or-v1- and go in Authorization: Bearer.'],
    'invalid-request': ['OpenRouter requires an HTTP-Referer header for some models — add it in Custom Headers.'],
    'invalid-model': ['OpenRouter ids are namespaced, e.g. anthropic/claude-sonnet-4.'],
  },
  litellm: {
    auth: ['Use LITELLM_MASTER_KEY, not the upstream provider key.'],
    'not-found': ['LiteLLM serves Anthropic passthrough at /anthropic — try that as the endpoint.'],
  },
  lumosel: {
    auth: ['Lumosel API keys start with lumo_live_ and use Authorization: Bearer or x-api-key.'],
    'not-found': ['Make sure you are using https://api.lumosel.vip (with the "api." subdomain, not the landing page).'],
  },
  bedrock: {
    auth: ['Bedrock expects SigV4 signing; a raw key only works through a signing proxy.'],
    'not-found': ['Bedrock has no /v1/models — use a gateway that emulates it.'],
  },
  vertex: {
    auth: ['Vertex bearer tokens expire after about an hour — mint a fresh one.'],
    'not-found': ['Vertex paths embed project and region and do not match Anthropic routes.'],
  },
  azure: { auth: ['Azure authenticates with the api-key header — add it under Custom Headers.'] },
};

function isHtmlResponse(rawText?: string, message?: string): boolean {
  if (rawText) {
    const trimmed = rawText.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || (trimmed.startsWith('<') && trimmed.includes('</'))) return true;
  }
  if (message && (/unexpected token '<'|is not valid json|<html/i.test(message))) {
    return true;
  }
  return false;
}

/** Turn any failure into a categorised, actionable error. */
export function classifyError(opts: {
  status?: number | null;
  message?: string;
  body?: unknown;
  rawText?: string;
  provider?: ProviderId | null;
}): ApiError {
  const status = opts.status ?? null;
  const body = opts.body as { error?: { type?: string; message?: string }; message?: string } | null | undefined;
  const providerType = body?.error?.type ?? null;
  const isHtml = isHtmlResponse(opts.rawText, opts.message);

  let cleanMessage =
    body?.error?.message ??
    body?.message ??
    opts.message ??
    '';

  if (isHtml) {
    if (status === 404) {
      cleanMessage = 'Endpoint not found. The server returned an HTML 404 web page instead of a JSON API response.';
    } else if (status === 403 || status === 401) {
      cleanMessage = `Request rejected (${status}). Received an HTML page, likely due to Cloudflare protection, a WAF, or an invalid path.`;
    } else if (status === 502) {
      cleanMessage = 'Bad Gateway (502). The upstream proxy or reverse gateway returned an HTML error.';
    } else if (status === 503) {
      cleanMessage = 'Service Unavailable (503). The upstream server is temporarily down or unreachable.';
    } else if (status === 504) {
      cleanMessage = 'Gateway Timeout (504). The upstream server timed out.';
    } else {
      cleanMessage = 'The URL returned an HTML web page instead of a JSON API response.';
    }
  } else if (/unexpected token/i.test(cleanMessage) && /json/i.test(cleanMessage)) {
    cleanMessage = 'The server returned a non-JSON response.';
  } else if (!cleanMessage) {
    cleanMessage = opts.rawText && !isHtml ? opts.rawText.slice(0, 400) : 'Request failed';
  }

  const category = categoryFor(status, providerType, cleanMessage);
  
  const customHtmlSuggestions = isHtml
    ? [
        'Check the base URL: if you entered a website landing page (e.g. "lumosel.vip"), make sure to use the API gateway subdomain (e.g. "https://api.lumosel.vip").',
        'Toggle the "Add /v1" checkbox if your provider expects or excludes "/v1" in the URL.',
        'If your provider does not support "/v1/models" listing, models can still be tested directly against "/v1/messages" by typing the id yourself.',
      ]
    : [];

  const suggestions = [
    ...customHtmlSuggestions,
    ...(opts.provider ? PROVIDER_FIXES[opts.provider]?.[category] ?? [] : []),
    ...GENERIC_FIXES[category],
  ];
  const explanation = status !== null ? STATUS_EXPLANATIONS[status] : undefined;

  return {
    category,
    title: status !== null ? `${status} — ${CATEGORY_TITLES[category]}` : CATEGORY_TITLES[category],
    message: cleanMessage || explanation || 'Request failed',
    httpStatus: status,
    providerType,
    suggestions,
    raw: opts.body ?? (opts.rawText ? (isHtml ? '(HTML Web Page / Document)' : opts.rawText) : null),
  };
}

export function categoryTitle(category: ErrorCategory): string {
  return CATEGORY_TITLES[category];
}
