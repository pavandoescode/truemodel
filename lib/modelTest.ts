import { sendMessage, streamMessages } from '@/lib/apiClient';
import { classifyError } from '@/lib/errors';
import { extractText, extractToolUses } from '@/lib/models';
import type {
  CheckStatus,
  EngineOptions,
  MessagesRequest,
  ModelTestKind,
  ModelTestResult,
  ToolDef,
} from '@/lib/types';

/** Short and verifiable: any working model answers this in a couple of tokens. */
export const DIAGNOSTIC_PROMPT = 'Reply with exactly: OK';
const TOOL_PROMPT = 'What is the weather in Paris? Use the get_weather tool.';
const TEXT_LIMIT = 2000;

const WEATHER_TOOL: ToolDef = {
  name: 'get_weather',
  description: 'Get the current weather in a given city.',
  input_schema: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name, e.g. "Paris"' } },
    required: ['city'],
  },
};

export interface ModelTestOptions extends EngineOptions {
  model: string;
  kind?: ModelTestKind;
  maxTokens?: number;
  prompt?: string;
}

/** Empty shell so every field is present even when we bail out early. */
export function blankResult(modelId: string, kind: ModelTestKind, status: CheckStatus): ModelTestResult {
  return {
    modelId,
    kind,
    status,
    httpStatus: null,
    latencyMs: null,
    ttftMs: null,
    usage: null,
    tokensPerSec: null,
    stopReason: null,
    text: '',
    error: null,
    request: null,
    response: null,
    at: Date.now(),
  };
}

export function cancelledResult(modelId: string, kind: ModelTestKind): ModelTestResult {
  const result = blankResult(modelId, kind, 'skip');
  result.error = classifyError({ status: null, message: 'Cancelled by user.' });
  return result;
}

function throughput(outputTokens: number | null | undefined, latencyMs: number | null): number | null {
  if (!outputTokens || !latencyMs || latencyMs <= 0) return null;
  return Math.round((outputTokens / (latencyMs / 1000)) * 10) / 10;
}

/** One diagnostic call against one model. Never throws. */
export async function testModel(opts: ModelTestOptions): Promise<ModelTestResult> {
  const kind = opts.kind ?? 'basic';
  const maxTokens = opts.maxTokens ?? (kind === 'tools' ? 256 : 32);
  const prompt = opts.prompt ?? (kind === 'tools' ? TOOL_PROMPT : DIAGNOSTIC_PROMPT);
  const streamed = kind === 'stream';

  const body: MessagesRequest = {
    model: opts.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (kind === 'tools') {
    body.tools = [WEATHER_TOOL];
    body.tool_choice = { type: 'auto' };
  }

  if (opts.signal?.aborted) {
    opts.log?.('warning', `Skipped ${opts.model} — cancelled.`);
    return cancelledResult(opts.model, kind);
  }

  const result = blankResult(opts.model, kind, 'running');
  result.request = body;
  opts.log?.('info', `Testing ${opts.model} (${kind})…`);

  let ok = false;
  let sentHeaders: Record<string, string> = {};
  let headers: Record<string, string> = {};
  let rawResponse: string | null = null;

  if (streamed) {
    const out = await streamMessages({ config: opts.config, body, provider: opts.provider, signal: opts.signal });
    ok = out.ok && !out.error;
    sentHeaders = out.sentHeaders;
    headers = out.headers;
    result.httpStatus = out.status || null;
    result.latencyMs = out.latencyMs;
    result.ttftMs = out.ttftMs;
    result.usage = out.usage;
    result.stopReason = out.stopReason;
    result.text = out.text.slice(0, TEXT_LIMIT);
    result.error = out.error;
    result.response = {
      text: out.text,
      usage: out.usage,
      stopReason: out.stopReason,
      eventCount: out.eventCount,
      toolUses: out.toolUses,
    };
    // No TTFT means the provider buffered the whole body instead of chunking.
    result.status = !ok ? 'fail' : out.text.trim() && out.ttftMs !== null ? 'pass' : 'partial';
  } else {
    const res = await sendMessage({ config: opts.config, body, provider: opts.provider, signal: opts.signal });
    const text = extractText(res.data);
    const toolUses = extractToolUses(res.data);
    ok = res.ok && !res.error;
    sentHeaders = res.sentHeaders;
    headers = res.headers;
    rawResponse = res.rawText;
    result.httpStatus = res.status || null;
    result.latencyMs = res.latencyMs;
    result.usage = res.data?.usage ?? null;
    result.stopReason = res.data?.stop_reason ?? null;
    result.text = text.slice(0, TEXT_LIMIT);
    result.error = res.error;
    result.response = res.data;
    // A tools run only passes when the model actually emitted a tool_use block.
    const produced = kind === 'tools' ? toolUses.length > 0 : text.trim() !== '';
    result.status = !ok ? 'fail' : produced ? 'pass' : 'partial';
  }

  result.tokensPerSec = throughput(result.usage?.output_tokens, result.latencyMs);
  result.at = Date.now();

  opts.record?.({
    kind: 'model-test',
    label: `${kind === 'tools' ? 'Tool test' : streamed ? 'Stream test' : 'Test'} — ${opts.model}`,
    model: opts.model,
    method: 'POST',
    path: '/v1/messages',
    status: result.httpStatus,
    ok,
    latencyMs: result.latencyMs,
    ttftMs: result.ttftMs,
    usage: result.usage,
    requestHeaders: sentHeaders,
    requestBody: streamed ? { ...body, stream: true } : body,
    responseHeaders: headers,
    responseBody: result.response,
    rawResponse,
    error: result.error,
    streamed,
  });

  if (opts.signal?.aborted) {
    result.status = 'skip';
    result.error = result.error ?? classifyError({ status: null, message: 'Cancelled by user.' });
    opts.log?.('warning', `${opts.model} cancelled.`);
    return result;
  }

  const detail = `${result.latencyMs ?? '?'} ms${result.ttftMs !== null ? `, TTFT ${result.ttftMs} ms` : ''}`;
  if (result.status === 'pass') opts.log?.('success', `${opts.model} passed (${detail}).`);
  else if (result.status === 'partial') opts.log?.('warning', `${opts.model} answered with no usable content (${detail}).`);
  else opts.log?.('error', `${opts.model} failed — ${result.error?.title ?? 'unknown error'}.`);

  return result;
}
