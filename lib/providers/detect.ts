import type { ProviderId } from '@/lib/types';

export interface DetectionInput {
  endpoint: string;
  responseHeaders?: Record<string, string>;
  modelIds?: string[];
  bodyText?: string;
}

export interface DetectionOutcome {
  provider: ProviderId;
  reasons: string[];
  confidence: 'high' | 'medium' | 'low';
}

const PRIVATE_HOST =
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
}

/**
 * Identify the provider from the endpoint, its response headers, and the
 * shape of the model ids it returns. Endpoint patterns win over heuristics.
 */
export function detectProvider(input: DetectionInput): DetectionOutcome {
  const host = hostOf(input.endpoint).toLowerCase();
  const headers = normalizeHeaders(input.responseHeaders);
  const models = input.modelIds ?? [];
  const reasons: string[] = [];

  const byHost: [RegExp, ProviderId, string][] = [
    [/(^|\.)anthropic\.com$/, 'anthropic', 'Endpoint is api.anthropic.com'],
    [/(^|\.)openrouter\.ai$/, 'openrouter', 'Endpoint host is openrouter.ai'],
    [/(^|\.)requesty\.ai$/, 'requesty', 'Endpoint host is requesty.ai'],
    [/bedrock.*\.amazonaws\.com$/, 'bedrock', 'Endpoint is an AWS Bedrock runtime host'],
    [/aiplatform\.googleapis\.com$/, 'vertex', 'Endpoint is a Google Vertex AI host'],
    [/(azure\.com|azure-api\.net|cognitiveservices\.azure\.com)$/, 'azure', 'Endpoint is an Azure host'],
  ];

  for (const [re, id, why] of byHost) {
    if (re.test(host)) return { provider: id, reasons: [why], confidence: 'high' };
  }

  // Header fingerprints.
  if (headers['x-openrouter-request-id'] || headers['x-or-request-id']) {
    return { provider: 'openrouter', reasons: ['OpenRouter request-id header present'], confidence: 'high' };
  }
  if (headers['x-litellm-version'] || headers['x-litellm-model-id'] || headers['x-litellm-call-id']) {
    return { provider: 'litellm', reasons: ['x-litellm-* response header present'], confidence: 'high' };
  }
  if (headers['x-requesty-request-id']) {
    return { provider: 'requesty', reasons: ['Requesty request-id header present'], confidence: 'high' };
  }
  if (headers['apim-request-id'] || headers['azureml-model-session']) {
    return { provider: 'azure', reasons: ['Azure APIM response header present'], confidence: 'high' };
  }

  if (PRIVATE_HOST.test(host)) {
    reasons.push('Endpoint resolves to localhost or a private network address');
    if (models.some((m) => m.includes('/'))) {
      reasons.push('Model ids are vendor-namespaced, typical of LiteLLM');
      return { provider: 'litellm', reasons, confidence: 'medium' };
    }
    if (input.bodyText && /litellm/i.test(input.bodyText)) {
      reasons.push('Response body mentions LiteLLM');
      return { provider: 'litellm', reasons, confidence: 'medium' };
    }
    return { provider: 'local', reasons, confidence: 'medium' };
  }

  if (input.bodyText && /litellm/i.test(input.bodyText)) {
    return { provider: 'litellm', reasons: ['Response body mentions LiteLLM'], confidence: 'medium' };
  }

  if (models.length && models.every((m) => /^claude-/.test(m))) {
    return {
      provider: 'custom',
      reasons: ['Returns bare Anthropic-style model ids from a non-Anthropic host'],
      confidence: 'low',
    };
  }

  return {
    provider: 'custom',
    reasons: reasons.length ? reasons : ['No known provider fingerprint matched'],
    confidence: 'low',
  };
}

function normalizeHeaders(h?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = v;
  return out;
}

/** True when the provider is known to deviate from the Anthropic API shape. */
export function hasKnownQuirks(id: ProviderId): boolean {
  return id === 'bedrock' || id === 'vertex' || id === 'azure';
}
