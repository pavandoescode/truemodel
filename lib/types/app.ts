/** Console logging, request history, profiles, playground, settings. */

import type { ApiError, Usage, ProviderId, ProviderConfig } from './index';

/* ------------------------------------------------------------------ */
/* Console                                                             */
/* ------------------------------------------------------------------ */

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  id: string;
  at: number;
  level: LogLevel;
  message: string;
}

export type LogFn = (level: LogLevel, message: string) => void;

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export type HistoryKind =
  | 'connection'
  | 'models'
  | 'audit'
  | 'suite'
  | 'model-test'
  | 'benchmark'
  | 'playground'
  | 'tool-test'
  | 'stream-compare';

export interface HistoryEntry {
  id: string;
  at: number;
  kind: HistoryKind;
  label: string;
  provider: ProviderId | null;
  endpoint: string;
  model: string | null;
  method: string;
  path: string;
  status: number | null;
  ok: boolean;
  latencyMs: number | null;
  ttftMs: number | null;
  usage: Usage | null;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseHeaders: Record<string, string>;
  responseBody: unknown;
  rawResponse: string | null;
  error: ApiError | null;
  favorite: boolean;
  streamed: boolean;
}

export interface HistoryFilter {
  search: string;
  kind: HistoryKind | 'all';
  status: 'all' | 'ok' | 'error';
  favoritesOnly: boolean;
}

export type ExportFormat = 'json' | 'csv' | 'markdown';

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export type ProfileStatus = 'tested' | 'untested' | 'failed';

export interface Profile {
  id: string;
  name: string;
  /** CSS colour used for the profile dot. */
  color: string;
  config: ProviderConfig;
  status: ProfileStatus;
  lastTestedAt: number | null;
  auditScore: number | null;
  recommendedModel: string | null;
}

/* ------------------------------------------------------------------ */
/* Playground                                                          */
/* ------------------------------------------------------------------ */

export interface PlaygroundParams {
  model: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  topK: number;
  stopSequences: string[];
  stream: boolean;
}

export interface PromptPreset {
  id: string;
  name: string;
  system: string;
  prompt: string;
  createdAt: number;
}

/* ------------------------------------------------------------------ */
/* App settings                                                        */
/* ------------------------------------------------------------------ */

export type ThemeMode = 'dark' | 'light' | 'system';

export interface AppSettings {
  theme: ThemeMode;
  concurrency: 1 | 3 | 5 | 10;
  benchmarkRuns: 5 | 10 | 20;
  consoleOpen: boolean;
  sidebarWidth: number;
  consoleHeight: number;
  persistKeys: boolean;
  autoAudit: boolean;
  confetti: boolean;
}

/* ------------------------------------------------------------------ */
/* Generated config                                                    */
/* ------------------------------------------------------------------ */

export interface GeneratedConfig {
  /** Only the fields that differ from the saved baseline. */
  snippet: Record<string, unknown>;
  /** Full object, for the "show everything" toggle. */
  full: Record<string, unknown>;
  json: string;
  envVars: { key: string; value: string }[];
}
