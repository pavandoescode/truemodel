import type { ProviderPreset, ProviderId } from '@/lib/types';
import { detectProvider } from '@/lib/providers/detect';

/**
 * One-click templates. Each preset pre-fills the endpoint, the auth header
 * style, and any headers the provider requires.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '◈',
    blurb: 'Direct first-party API',
    endpoint: 'https://api.anthropic.com',
    authStyle: 'x-api-key',
    headers: [],
    accent: '#d97757',
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    tips: [
      'Keys start with sk-ant-. Paste the full key including the prefix.',
      'The anthropic-version header is required and sent automatically.',
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '◇',
    blurb: 'Multi-provider router',
    endpoint: 'https://openrouter.ai/api/v1',
    authStyle: 'bearer',
    headers: [
      { key: 'HTTP-Referer', value: 'http://localhost:3000' },
      { key: 'X-Title', value: 'Provider Validator' },
    ],
    accent: '#6467f2',
    docsUrl: 'https://openrouter.ai/docs',
    tips: [
      'Some models reject requests without an HTTP-Referer header.',
      'Model ids are namespaced, e.g. anthropic/claude-sonnet-4.',
      'A router picks a backend per request, so the same id can be served by different hosts — run Identify models to see what answered.',
    ],
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    icon: '◆',
    blurb: 'Self-hosted gateway',
    endpoint: 'http://localhost:4000',
    authStyle: 'bearer',
    headers: [],
    accent: '#22c55e',
    docsUrl: 'https://docs.litellm.ai/docs/anthropic_completion',
    tips: [
      'Use the LITELLM_MASTER_KEY (sk-...) as the API key.',
      'Anthropic passthrough usually lives at /anthropic — try that path if /v1/messages 404s.',
    ],
  },
  {
    id: 'requesty',
    name: 'Requesty',
    icon: '⬗',
    blurb: 'Routing + caching layer',
    endpoint: 'https://router.requesty.ai/v1',
    authStyle: 'bearer',
    headers: [],
    accent: '#f59e0b',
    docsUrl: 'https://docs.requesty.ai',
    tips: ['Model ids are namespaced by vendor, e.g. anthropic/claude-sonnet-4.'],
  },
  {
    id: 'lumosel',
    name: 'Lumosel',
    icon: '⚡',
    blurb: 'Third-party reseller',
    endpoint: 'https://api.lumosel.vip',
    authStyle: 'bearer',
    headers: [],
    accent: '#06b6d4',
    tips: [
      'Endpoint must be the API subdomain: https://api.lumosel.vip (not the website landing page).',
      'API keys start with lumo_live_...',
      'Advertises the Anthropic lineup. It resells rather than hosts, so the advertised id and the served model are worth checking separately — that is what Identify models is for.',
    ],
  },
  {
    id: 'bedrock',
    name: 'AWS Bedrock',
    icon: '▲',
    blurb: 'Amazon-hosted Claude',
    endpoint: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    authStyle: 'bearer',
    headers: [],
    accent: '#ff9900',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/',
    tips: [
      'Bedrock normally requires SigV4 request signing, which a bare API key cannot do.',
      'Point this at a Bedrock proxy, or use a short-lived bearer token if your gateway issues one.',
      'Model listing uses a different path — expect the Model Listing check to fail.',
    ],
  },
  {
    id: 'vertex',
    name: 'Google Vertex AI',
    icon: '✦',
    blurb: 'Google Cloud Claude',
    endpoint: 'https://us-east5-aiplatform.googleapis.com/v1',
    authStyle: 'bearer',
    headers: [],
    accent: '#4285f4',
    docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude',
    tips: [
      'Use an OAuth access token (gcloud auth print-access-token) as the key — it expires hourly.',
      'Vertex paths embed the project and region, so /v1/models will not match Anthropic shape.',
    ],
  },
  {
    id: 'azure',
    name: 'Azure',
    icon: '❖',
    blurb: 'Azure AI gateway',
    endpoint: 'https://YOUR-RESOURCE.openai.azure.com',
    authStyle: 'bearer',
    headers: [{ key: 'api-key', value: '' }],
    accent: '#0078d4',
    tips: [
      'Azure authenticates with the api-key header — paste your key into the header row too.',
      'Deployments require an api-version query parameter on every call.',
    ],
  },
  {
    id: 'local',
    name: 'Local proxy',
    icon: '⬒',
    blurb: 'localhost / private network',
    endpoint: 'http://localhost:8787',
    authStyle: 'x-api-key',
    headers: [],
    accent: '#38bdf8',
    tips: ['Anything on localhost or a private IP is detected as a local proxy.'],
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⬢',
    blurb: 'Any Anthropic-shaped host',
    endpoint: '',
    authStyle: 'x-api-key',
    headers: [],
    accent: '#8b5cf6',
    tips: ['Anything exposing POST /v1/messages in Anthropic format should work.'],
  },
];

export const PRESET_BY_ID: Record<ProviderId, ProviderPreset> = PROVIDER_PRESETS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<ProviderId, ProviderPreset>,
);

export function getPreset(id: ProviderId): ProviderPreset {
  return PRESET_BY_ID[id] ?? PRESET_BY_ID.custom;
}

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Hosts that identify nobody: localhost (LiteLLM and Local both use it) and
 * the Azure preset's `YOUR-RESOURCE` placeholder. Fingerprinting handles these. */
const UNIDENTIFYING_HOST = /^(localhost|127\.|0\.0\.0\.0|\[?::1|host\.docker\.internal|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|your-resource/i;

/**
 * Which preset an endpoint belongs to, judged by host.
 *
 * A preset's own host wins over `detectProvider`, because several presets are
 * resellers that no fingerprint can recognise — Lumosel authenticates with
 * Bearer, and falling through to the generic `custom` preset would silently
 * send `x-api-key` and fail every request. Only when no preset host matches do
 * we fall back to fingerprinting, and `custom` is the last resort.
 */
export function presetForEndpoint(endpoint: string): ProviderPreset {
  const host = hostOf(endpoint);
  if (!host) return PRESET_BY_ID.custom;
  for (const preset of PROVIDER_PRESETS) {
    if (preset.id === 'custom' || !preset.endpoint) continue;
    const presetHost = hostOf(preset.endpoint);
    if (!presetHost || UNIDENTIFYING_HOST.test(presetHost)) continue;
    if (presetHost === host) return preset;
  }
  return getPreset(detectProvider({ endpoint }).provider);
}
