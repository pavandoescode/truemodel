/** Compatibility audit, realistic test suite, and readiness verdict types. */

import type { ApiError, Usage } from './index';

export type CheckStatus = 'pending' | 'running' | 'pass' | 'partial' | 'fail' | 'skip';

export type AuditCheckId =
  | 'auth'
  | 'model-listing'
  | 'chat-completions'
  | 'streaming'
  | 'tool-calling'
  | 'system-prompts'
  | 'multi-turn'
  | 'large-context'
  | 'json-mode'
  | 'usage-reporting'
  | 'response-format'
  | 'error-format'
  | 'rate-limit-headers';

export interface AuditCheckDef {
  id: AuditCheckId;
  /** 1-based position shown in the checklist. */
  index: number;
  label: string;
  /** "What it tests" column. */
  tests: string;
  /** Longer explanation shown when the row is expanded. */
  description: string;
  /** An endpoint that fails this cannot be used at all, whoever it resells. */
  critical: boolean;
}

export interface AuditCheckResult {
  id: AuditCheckId;
  status: CheckStatus;
  /** One-line outcome, e.g. "SSE stream delivered 24 events". */
  message: string;
  detail?: string;
  latencyMs?: number | null;
  httpStatus?: number | null;
  request?: unknown;
  response?: unknown;
  rawResponse?: string | null;
  error?: ApiError | null;
  at: number;
}

export type AuditVerdict = 'ready' | 'partial' | 'incompatible' | 'unknown';

export interface AuditReport {
  model: string;
  results: AuditCheckResult[];
  /** 0–100, weighted so critical checks count double. */
  score: number;
  passed: number;
  partial: number;
  failed: number;
  total: number;
  verdict: AuditVerdict;
  startedAt: number;
  finishedAt: number;
  rateLimits: import('./proxy').RateLimitInfo | null;
}

/* ------------------------------------------------------------------ */
/* Realistic test suite                                               */
/* ------------------------------------------------------------------ */

export type SuiteTestId =
  | 'simple-chat'
  | 'code-generation'
  | 'code-editing'
  | 'tool-invocation'
  | 'json-output'
  | 'streaming-response'
  | 'large-prompt'
  | 'markdown-formatting'
  | 'multi-turn-context'
  | 'long-code-generation';

export interface SuiteTestDef {
  id: SuiteTestId;
  label: string;
  /** "What it simulates" column. */
  simulates: string;
  description: string;
  /** Approximate input size hint shown in the UI. */
  weight: 'light' | 'medium' | 'heavy';
}

export interface SuiteTestResult {
  id: SuiteTestId;
  label: string;
  status: CheckStatus;
  message: string;
  latencyMs: number | null;
  ttftMs: number | null;
  usage: Usage | null;
  tokensPerSec: number | null;
  output: string;
  failReason: string | null;
  request?: unknown;
  response?: unknown;
  error?: ApiError | null;
  at: number;
}

export interface SuiteReport {
  model: string;
  results: SuiteTestResult[];
  passed: number;
  partial: number;
  failed: number;
  total: number;
  score: number;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  startedAt: number;
  finishedAt: number;
}

/* ------------------------------------------------------------------ */
/* Switch readiness                                                    */
/* ------------------------------------------------------------------ */

export interface ReadinessItem {
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ReadinessReport {
  items: ReadinessItem[];
  safe: boolean;
  /** 0–100 overall confidence. */
  score: number;
  recommendedModel: string | null;
  blockers: string[];
  warnings: string[];
}
