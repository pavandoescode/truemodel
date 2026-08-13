import { proxy } from '@/lib/apiClient';
import { classifyError } from '@/lib/errors';
import { specFor, vendorLabelOf } from '@/lib/registry';
import type {
  ContentBlock,
  MessagesResponse,
  ModelInfo,
  ProviderConfig,
  ProviderId,
  ProxyResponse,
  WireConfig,
} from '@/lib/types';

/**
 * Model discovery.
 *
 * Capability metadata a provider omits is filled in from `lib/registry`, which is
 * also what the identity probe compares against — one table, so a family's
 * published limits cannot say one thing here and another there.
 */
function num(value: unknown): number | null {
  if (typeof value === 'bigint') {
    return value > 0 ? Number(value) : null;
  }
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

/** Accept Anthropic, OpenAI-compatible, and OpenRouter model list shapes. */
export function normalizeModels(payload: unknown): ModelInfo[] {
  const root = payload as Record<string, unknown> | null;
  const list =
    (Array.isArray(root?.data) && root!.data) ||
    (Array.isArray(root?.models) && root!.models) ||
    (Array.isArray(payload) && payload) ||
    [];

  const seen = new Map<string, string>();
  const models: ModelInfo[] = [];

  for (const raw of list as unknown[]) {
    if (typeof raw === 'string') {
      models.push(baseModel(raw, raw, {}, raw));
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const id = String(pick(obj, ['id', 'model', 'name', 'model_name']) ?? '').trim();
    if (!id) continue;
    const displayName = String(pick(obj, ['display_name', 'displayName', 'name']) ?? id);
    models.push(baseModel(id, displayName, obj, raw));
  }

  // Mark duplicates: the same trailing segment from a namespaced id.
  for (const m of models) {
    const key = m.id.split('/').pop()!.toLowerCase();
    const first = seen.get(key);
    if (first && first !== m.id) m.duplicateOf = first;
    else seen.set(key, m.id);
  }

  return models;
}

function baseModel(id: string, displayName: string, obj: Record<string, unknown>, raw: unknown): ModelInfo {
  const isClaude = /claude/i.test(id);
  const known = specFor(id);
  const top = (obj.top_provider ?? {}) as Record<string, unknown>;
  const arch = (obj.architecture ?? {}) as Record<string, unknown>;
  const supported = Array.isArray(obj.supported_parameters) ? (obj.supported_parameters as string[]) : null;
  const lifecycle = String(pick(obj, ['status', 'lifecycle_status', 'state']) ?? '').toLowerCase();

  const contextWindow =
    num(pick(obj, ['context_window', 'context_length', 'max_input_tokens', 'max_context_length'])) ??
    num(top.context_length) ??
    known?.context ??
    null;
  const maxOutput =
    num(pick(obj, ['max_output_tokens', 'max_tokens', 'max_completion_tokens'])) ??
    num(top.max_completion_tokens) ??
    known?.output ??
    null;

  const supportsTools =
    supported ? supported.includes('tools') || supported.includes('tool_choice') : isClaude ? true : null;
  const supportsStreaming = supported ? !supported.includes('no_stream') : isClaude ? true : null;

  return {
    id,
    displayName,
    contextWindow,
    maxOutput,
    supportsTools,
    supportsStreaming,
    vendor: vendorLabelOf(id),
    isClaude,
    deprecated: /deprecat|retir|legacy|sunset/.test(lifecycle) || Boolean(known?.deprecated),
    duplicateOf: null,
    createdAt:
      typeof obj.created_at === 'string'
        ? obj.created_at
        : typeof obj.created === 'number'
          ? new Date(obj.created * 1000).toISOString()
          : null,
    family: known?.family ?? (isClaude ? 'Claude' : (arch.modality as string | undefined) ?? null),
    raw,
  };
}

/**
 * Fallback lineup for endpoints with no model list.
 *
 * A resold endpoint that answers `/v1/messages` but publishes no `/v1/models`
 * still has to be given something to ask for, and these are the ids such an
 * endpoint almost always advertises. Built from the registry rather than
 * hand-written, so these entries claim exactly the limits the identity probe
 * will later hold the endpoint to.
 */
export const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'claude-fable-5', displayName: 'Claude Fable 5' },
  { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', createdAt: '2025-10-01' },
].map(({ id, displayName, createdAt }: { id: string; displayName: string; createdAt?: string }) => {
  const spec = specFor(id)!;
  return {
    id,
    displayName,
    contextWindow: spec.context,
    maxOutput: spec.output,
    supportsTools: true,
    supportsStreaming: true,
    vendor: vendorLabelOf(id),
    isClaude: true,
    deprecated: false,
    duplicateOf: null,
    createdAt: createdAt ?? null,
    family: spec.family,
    raw: { provider: 'default-suite' },
  };
});

export interface ListModelsResult {
  models: ModelInfo[];
  response: ProxyResponse<unknown>;
  isFallback?: boolean;
}

/** Try /v1/models, then /models for gateways that omit the version prefix. */
export async function listModels(
  config: ProviderConfig | WireConfig,
  opts: { provider?: ProviderId | null; signal?: AbortSignal; allowFallback?: boolean } = {},
): Promise<ListModelsResult> {
  const paths = ['/v1/models', '/models'];
  let last: ProxyResponse<unknown> | null = null;
  for (const path of paths) {
    const response = await proxy<unknown>({ config, path, method: 'GET', ...opts });
    last = response;
    if (response.ok) {
      const models = normalizeModels(response.data);
      if (models.length) return { models, response, isFallback: false };
    }
    if (response.status && response.status !== 404) break;
  }
  if (!last) {
    last = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      latencyMs: 0,
      headers: {},
      data: null,
      rawText: '',
      error: classifyError({ status: 404, message: 'No models endpoint found at /v1/models or /models' }),
      url: '',
      sentHeaders: {},
    };
  }

  // If allowFallback is not explicitly disabled, provide a standard lineup so the user is not blocked
  if (opts.allowFallback !== false) {
    return { models: FALLBACK_MODELS, response: last, isFallback: true };
  }

  return { models: [], response: last, isFallback: false };
}

/**
 * Whether a fallback lineup is papering over a failure the user has to see.
 *
 * Most resold endpoints simply do not publish `/v1/models`, and that is the
 * whole reason FALLBACK_MODELS exists — a 404 there says nothing about whether
 * the key works, so the lineup stands in and the run proceeds.
 *
 * A rejected key, an unreachable host or a 5xx is different in kind: every
 * probe against that lineup would fail the same way, so listing four models
 * under a "Connected" badge would be a false reading from a tool whose whole
 * job is to not give false readings. Those get reported as a failure instead.
 */
export function isHardDiscoveryFailure(result: ListModelsResult): boolean {
  if (!result.isFallback) return false;
  // No error at all — an endpoint that answered with an empty catalogue. Benign.
  if (!result.response.error) return false;
  return result.response.status !== 404;
}

export function extractText(res: MessagesResponse | null | undefined): string {
  if (!res) return '';
  const blocks = res.content;
  if (typeof blocks === 'string') return blocks;
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((b): b is ContentBlock & { text: string } => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

export function extractToolUses(res: MessagesResponse | null | undefined): { id: string; name: string; input: unknown }[] {
  const blocks = res?.content;
  if (!Array.isArray(blocks)) return [];
  return blocks
    .filter((b) => b?.type === 'tool_use')
    .map((b) => {
      const t = b as { id?: string; name?: string; input?: unknown };
      return { id: t.id ?? '', name: t.name ?? '', input: t.input ?? {} };
    });
}

/**
 * A sensible model to probe first, for any provider.
 *
 * No vendor preference: on a resold endpoint the whole point is that we do not
 * know whose models these are. What makes a good default is that the registry
 * recognises the id — only then can a mismatch later be scored against
 * published limits — that it is current rather than retired, and that it is a
 * cheap tier, since verification sends several requests.
 */
export function pickDefaultModel(models: ModelInfo[]): string | null {
  if (!models.length) return null;
  const ranked = [...models].sort((a, b) => score(b) - score(a));
  return ranked[0]?.id ?? null;
}

function score(m: ModelInfo): number {
  let s = 0;
  if (m.vendor) s += 100; // a recognised id, so its claims are checkable
  if (!m.deprecated) s += 40;
  if (!m.duplicateOf) s += 10;
  // Cheap and fast first: a default is for a smoke test, not a benchmark.
  if (/haiku|mini|nano|flash|lite|small|8b|7b/i.test(m.id)) s += 12;
  if (m.supportsTools) s += 3;
  if (m.supportsStreaming) s += 3;
  return s;
}
