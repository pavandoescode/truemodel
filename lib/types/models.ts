/** Model discovery, per-model testing, benchmarking, recommendation. */

import type { ApiError, Usage, CheckStatus, AuditReport, SuiteReport, ProviderId, ProviderConfig } from './index';

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number | null;
  maxOutput: number | null;
  supportsTools: boolean | null;
  supportsStreaming: boolean | null;
  /** Vendor the id claims, as a display label. Null when the id is unrecognised. */
  vendor: string | null;
  /**
   * True for ids on the Anthropic wire protocol. Only used to fill in defaults
   * for capabilities a provider did not publish — not a filter, since every
   * vendor's models are treated alike.
   */
  isClaude: boolean;
  deprecated: boolean;
  /** Set when another entry in the list resolves to the same model. */
  duplicateOf: string | null;
  createdAt: string | null;
  family: string | null;
  raw: unknown;
}

export type ModelTestKind = 'basic' | 'stream' | 'tools';

export interface ModelTestResult {
  modelId: string;
  kind: ModelTestKind;
  status: CheckStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  ttftMs: number | null;
  usage: Usage | null;
  tokensPerSec: number | null;
  stopReason: string | null;
  text: string;
  error: ApiError | null;
  request?: unknown;
  response?: unknown;
  at: number;
}

/** Keyed by model id. */
export type ModelTestMap = Record<string, ModelTestResult>;

export interface BatchRunSummary {
  total: number;
  tested: number;
  passed: number;
  failed: number;
  skipped: number;
  fastest: { modelId: string; latencyMs: number } | null;
  slowest: { modelId: string; latencyMs: number } | null;
  avgLatencyMs: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  startedAt: number;
  finishedAt: number | null;
  cancelled: boolean;
}

/* ------------------------------------------------------------------ */
/* Benchmarking                                                        */
/* ------------------------------------------------------------------ */

export interface BenchStats {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface BenchSample {
  index: number;
  ok: boolean;
  latencyMs: number | null;
  ttftMs: number | null;
  outputTokens: number | null;
  tokensPerSec: number | null;
  error: ApiError | null;
}

export interface BenchmarkRun {
  id: string;
  modelId: string;
  requested: number;
  samples: BenchSample[];
  latency: BenchStats | null;
  ttft: BenchStats | null;
  throughput: BenchStats | null;
  successRate: number;
  startedAt: number;
  finishedAt: number | null;
  streamed: boolean;
}

/* ------------------------------------------------------------------ */
/* Recommendation                                                      */
/* ------------------------------------------------------------------ */

export interface ModelScore {
  modelId: string;
  score: number;
  reasons: string[];
  warnings: string[];
  metrics: {
    latencyMs: number | null;
    ttftMs: number | null;
    tokensPerSec: number | null;
    errorRate: number;
    streaming: boolean | null;
    tools: boolean | null;
    contextWindow: number | null;
  };
}

export interface Recommendation {
  best: ModelScore | null;
  runnerUp: ModelScore | null;
  all: ModelScore[];
  /** Explains why no model could be recommended, when best is null. */
  note: string | null;
}

/* ------------------------------------------------------------------ */
/* Provider comparison                                                 */
/* ------------------------------------------------------------------ */

export interface ComparisonCandidate {
  id: string;
  name: string;
  config: ProviderConfig;
  detected: ProviderId | null;
}

export interface ComparisonRow {
  id: string;
  name: string;
  detected: ProviderId | null;
  avgLatencyMs: number | null;
  streaming: CheckStatus;
  toolCalling: CheckStatus;
  successRate: number;
  score: number;
  recommendedModel: string | null;
  audit: AuditReport | null;
  suite: SuiteReport | null;
  error: string | null;
  winner: boolean;
}
