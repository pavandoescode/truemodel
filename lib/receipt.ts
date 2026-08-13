/**
 * Evidence receipt serializer.
 *
 * A run of the identity check is only useful as an accusation if a stranger can
 * check it. This turns the in-memory reports into a self-contained artifact: a
 * human-readable Markdown write-up plus an embedded machine-readable JSON block
 * so anyone can re-run the same checks against the same host and compare.
 *
 * One rule dominates every function here: the API key never leaves. We display
 * the host and nothing else about the endpoint, and we never serialize the raw
 * config. A receipt someone posts publicly must not be the thing that leaks
 * their credential.
 */

import { isoStamp } from '@/lib/format';
import { VERDICT_LABEL } from '@/lib/identity';
import { REGISTRY_VERSION } from '@/lib/registry';
import type { IdentityReport, IdentitySignal } from '@/lib/types/identity';

/** Mirrors the version in package.json; recorded so a receipt names the tool that made it. */
export const TOOL_VERSION = '1.0.0';

export interface ReceiptInput {
  /** config.endpoint; may contain a path but never a key. Only its host is used. */
  endpoint: string;
  /** Object.values(identities) — the verified models, in whatever order. */
  reports: IdentityReport[];
  /** When the run happened. Defaults to Date.now(). */
  at?: number;
}

/**
 * The only value we ever take from the endpoint: its host.
 *
 * `new URL(...).host` strips any embedded `user:password@` credentials for us —
 * that is the whole point of parsing rather than string-slicing. When parsing
 * fails we fall back to a conservative extraction that still refuses to emit
 * anything resembling a credential (nothing before an `@`, no query/fragment).
 */
function safeHost(endpoint: string): string {
  const raw = (endpoint ?? '').trim();
  if (!raw) return 'unknown-host';
  try {
    const host = new URL(raw).host;
    if (host) return host;
  } catch {
    /* fall through to manual extraction */
  }
  // No usable URL. Strip scheme, then everything from the first `@` back (any
  // userinfo), then any path/query/fragment — leaving at most a host-like token.
  let rest = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const at = rest.indexOf('@');
  if (at !== -1) rest = rest.slice(at + 1);
  rest = rest.split(/[/?#]/, 1)[0] ?? '';
  const host = rest.trim();
  return host || 'unknown-host';
}

/** Compact timestamp for filenames: YYYYMMDD-HHMMSS in UTC, derived from `at`. */
function stampCompact(at: number): string {
  const d = new Date(Number.isFinite(at) ? at : Date.now());
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** The structured, reproducible payload — faithful to the reports, still key-free. */
interface ReceiptModel {
  requested: string;
  verdict: IdentityReport['verdict'];
  confidence: number;
  advertised: IdentityReport['advertised'];
  served: { id: string | null; family: string | null; vendor: string | null } | null;
  signals: Array<{
    id: IdentitySignal['id'];
    label: string;
    status: IdentitySignal['status'];
    weight: IdentitySignal['weight'];
    detail: string;
  }>;
  tokenizerCount: number | null;
}

interface ReceiptPayload {
  tool: string;
  registry: string;
  host: string;
  at: string;
  models: ReceiptModel[];
}

/** Reduce one report to its reproducible facts. */
function toModel(report: IdentityReport): ReceiptModel {
  const attr = report.attribution;
  return {
    requested: report.modelId,
    verdict: report.verdict,
    confidence: report.confidence,
    advertised: report.advertised,
    served: attr
      ? { id: attr.servedModelId, family: attr.servedFamily, vendor: attr.servedVendor }
      : null,
    signals: report.signals.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      weight: s.weight,
      detail: s.detail,
    })),
    tokenizerCount: report.tokenizerCount,
  };
}

/** Build the structured payload shared by the JSON block and any parser. */
function buildPayload(input: ReceiptInput): ReceiptPayload {
  const at = input.at ?? Date.now();
  return {
    tool: TOOL_VERSION,
    registry: REGISTRY_VERSION,
    host: safeHost(input.endpoint),
    at: isoStamp(at),
    models: (input.reports ?? []).map(toModel),
  };
}

/**
 * The machine-readable half of the receipt: `JSON.stringify` of the payload at
 * 2-space indent. Kept faithful to the reports so a third party can parse and
 * reproduce — and, like everything here, carrying no key.
 */
export function buildReceiptJson(input: ReceiptInput): string {
  return JSON.stringify(buildPayload(input), null, 2);
}

/** One evidence line per signal: label, status, optional context tag, raw detail. */
function signalLine(signal: IdentitySignal): string {
  const status = signal.status.toUpperCase();
  const context = signal.weight === 'context' ? ' (context)' : '';
  return `- ${signal.label} — ${status}${context}: ${signal.detail}`;
}

/** Render one model section: verdict, what it was sold as, what served, evidence. */
function modelSection(report: IdentityReport): string {
  const lines: string[] = [];
  lines.push(`## ${report.modelId}`);
  lines.push('');

  const label = VERDICT_LABEL[report.verdict] ?? report.verdict;
  lines.push(`- Verdict: ${label} (${report.confidence}% confidence)`);

  if (report.advertised) {
    const a = report.advertised;
    lines.push(`- Sold as: ${a.vendor} ${a.family}`);
  }

  const attr = report.attribution;
  if (attr?.servedModelId) {
    const extra = [attr.servedFamily, attr.servedVendor].filter(Boolean).join(', ');
    lines.push(`- Served: ${attr.servedModelId}${extra ? ` (${extra})` : ''}`);
  }

  if (attr?.summary) {
    lines.push(`- Attribution: ${attr.summary}`);
  }

  if (report.tokenizerCount !== null && report.tokenizerCount !== undefined) {
    lines.push(`- Tokenizer count: ${report.tokenizerCount}`);
  }

  lines.push('');
  if (report.signals.length > 0) {
    lines.push('Signals:');
    for (const signal of report.signals) lines.push(signalLine(signal));
  } else {
    lines.push('_No signals recorded._');
  }

  return lines.join('\n');
}

/**
 * The full human-readable receipt: a metadata header, one section per model
 * with its verdict and raw evidence, a note on how to reproduce it, and finally
 * the embedded JSON so the document is both readable and parseable.
 *
 * An empty `reports` array is valid: it produces a receipt that plainly states
 * no models were tested, rather than throwing.
 */
export function buildReceiptMarkdown(input: ReceiptInput): string {
  const at = input.at ?? Date.now();
  const host = safeHost(input.endpoint);
  const reports = input.reports ?? [];

  const out: string[] = [];
  out.push('# Provider Validator — Evidence Receipt');
  out.push('');
  out.push(`- Host: ${host}`);
  out.push(`- Checked at: ${isoStamp(at)}`);
  out.push(`- Tool version: ${TOOL_VERSION}`);
  out.push(`- Registry version: ${REGISTRY_VERSION}`);
  out.push(`- Models tested: ${reports.length}`);
  out.push('');

  if (reports.length === 0) {
    out.push('_No models were tested in this run._');
    out.push('');
  } else {
    for (const report of reports) {
      out.push(modelSection(report));
      out.push('');
    }
  }

  out.push('## Reproduce');
  out.push('');
  out.push(
    `Anyone can re-run these exact checks against \`${host}\` with Provider Validator ` +
      `${TOOL_VERSION} and registry ${REGISTRY_VERSION}, and should observe the same ` +
      `serving-stack facts. Only the host is recorded here — no API key or auth header ` +
      `is included, so this receipt is safe to share.`,
  );
  out.push('');

  out.push('## Machine-readable');
  out.push('');
  out.push('```json');
  out.push(buildReceiptJson(input));
  out.push('```');
  out.push('');

  return out.join('\n');
}

/**
 * A share-friendly filename: `provider-validator-<host>-<YYYYMMDD-HHMMSS>.md`,
 * with the host sanitized to `[a-z0-9.-]` so it is safe on any filesystem.
 */
export function receiptFilename(input: ReceiptInput): string {
  const at = input.at ?? Date.now();
  const host = safeHost(input.endpoint)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'host';
  return `provider-validator-${host}-${stampCompact(at)}.md`;
}
