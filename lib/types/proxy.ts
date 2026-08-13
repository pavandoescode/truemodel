/** Proxy envelope + Anthropic Messages API shapes. */

import type { ApiError, WireConfig } from './core';

/* ------------------------------------------------------------------ */
/* Proxy                                                               */
/* ------------------------------------------------------------------ */

export interface ProxyRequest {
  config: WireConfig;
  /** Path appended to the endpoint, e.g. `/v1/models`. */
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  /** Extra query params appended to the URL. */
  query?: Record<string, string>;
}

export interface ProxyResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  headers: Record<string, string>;
  data: T | null;
  rawText: string;
  error: ApiError | null;
  url: string;
  /** Request headers actually sent upstream, secrets already masked. */
  sentHeaders: Record<string, string>;
}

/** One line of the NDJSON envelope emitted by `POST /api/stream`. */
export type StreamEnvelope =
  | { type: 'open'; status: number; headers: Record<string, string>; url: string; sentHeaders: Record<string, string> }
  | { type: 'delta'; text: string }
  | { type: 'event'; event: string; data: unknown }
  | { type: 'toolUse'; id: string; name: string; input: unknown }
  | { type: 'error'; error: ApiError }
  | { type: 'done'; usage: Usage | null; stopReason: string | null; latencyMs: number; eventCount: number };

export interface StreamOutcome {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  sentHeaders: Record<string, string>;
  text: string;
  events: { event: string; data: unknown }[];
  toolUses: { id: string; name: string; input: unknown }[];
  usage: Usage | null;
  stopReason: string | null;
  /** Time to first token, measured client-side. */
  ttftMs: number | null;
  latencyMs: number;
  eventCount: number;
  error: ApiError | null;
}

/* ------------------------------------------------------------------ */
/* Messages API                                                        */
/* ------------------------------------------------------------------ */

export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  total_tokens?: number | null;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: ToolDef[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
}

export interface MessagesResponse {
  id?: string;
  type?: string;
  role?: string;
  model?: string;
  content?: ContentBlock[];
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage?: Usage | null;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Rate limits                                                         */
/* ------------------------------------------------------------------ */

export interface RateLimitInfo {
  requestsLimit: number | null;
  requestsRemaining: number | null;
  requestsResetAt: string | null;
  tokensLimit: number | null;
  tokensRemaining: number | null;
  tokensResetAt: string | null;
  inputTokensLimit: number | null;
  inputTokensRemaining: number | null;
  outputTokensLimit: number | null;
  outputTokensRemaining: number | null;
  retryAfterSeconds: number | null;
  tier: string | null;
  /** True when at least one rate-limit header was present. */
  present: boolean;
  raw: Record<string, string>;
}
