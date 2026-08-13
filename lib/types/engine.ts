/** Shared options + reports for the engine layer (lib/audit, lib/testSuite, …). */

import type {
  ApiError,
  CheckStatus,
  HistoryKind,
  LogFn,
  ProviderConfig,
  ProviderId,
  Usage,
} from './index';

/** A request/response pair an engine wants written to history. */
export interface HistoryDraft {
  kind: HistoryKind;
  label: string;
  model?: string | null;
  method?: string;
  path?: string;
  status?: number | null;
  ok: boolean;
  latencyMs?: number | null;
  ttftMs?: number | null;
  usage?: Usage | null;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  rawResponse?: string | null;
  error?: ApiError | null;
  streamed?: boolean;
}

/** Every engine entry point takes at least this. */
export interface EngineOptions {
  config: ProviderConfig;
  provider?: ProviderId | null;
  log?: LogFn;
  record?: (draft: HistoryDraft) => void;
  signal?: AbortSignal;
}

/* ------------------------------------------------------------------ */
/* Tool-use flow test                                                  */
/* ------------------------------------------------------------------ */

export interface ToolTestStep {
  id: 'request' | 'tool-call' | 'tool-result' | 'final';
  label: string;
  status: CheckStatus;
  detail: string;
  payload?: unknown;
  latencyMs?: number | null;
}

export interface ToolTestReport {
  model: string;
  status: CheckStatus;
  steps: ToolTestStep[];
  toolName: string | null;
  toolInput: unknown;
  finalText: string;
  usage: Usage | null;
  totalLatencyMs: number;
  error: ApiError | null;
  startedAt: number;
  finishedAt: number;
}

/* ------------------------------------------------------------------ */
/* Streaming vs non-streaming comparison                               */
/* ------------------------------------------------------------------ */

export interface StreamCompareSide {
  mode: 'stream' | 'blocking';
  ok: boolean;
  ttftMs: number | null;
  totalMs: number | null;
  outputTokens: number | null;
  tokensPerSec: number | null;
  text: string;
  eventCount: number | null;
  error: ApiError | null;
}

export interface StreamCompareReport {
  model: string;
  prompt: string;
  stream: StreamCompareSide | null;
  blocking: StreamCompareSide | null;
  /** 0–1 similarity of the two outputs. */
  consistency: number | null;
  ttftAdvantageMs: number | null;
  startedAt: number;
  finishedAt: number;
}
