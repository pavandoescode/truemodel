import { maskSecret } from '@/lib/server/upstream';
import type { AuditVerdict, CheckStatus } from '@/lib/types';

const DASH = '—';

/** Guard every formatter: null, undefined, NaN and ±Infinity all render as a dash. */
function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function ms(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null) return DASH;
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)} s`;
}

export function seconds(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null) return DASH;
  if (n < 60) return `${n < 10 ? n.toFixed(1) : Math.round(n)}s`;
  if (n < 3600) {
    const mins = Math.floor(n / 60);
    const rest = Math.round(n % 60);
    return rest ? `${mins}m ${rest}s` : `${mins}m`;
  }
  const hours = Math.floor(n / 3600);
  const mins = Math.round((n % 3600) / 60);
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

export function compactNumber(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null) return DASH;
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${trimZero(n / 1000)}k`;
  if (abs < 1_000_000_000) return `${trimZero(n / 1_000_000)}M`;
  return `${trimZero(n / 1_000_000_000)}B`;
}

function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

export function tokens(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null) return DASH;
  return Math.abs(n) < 10_000 ? Math.round(n).toLocaleString('en-US') : compactNumber(n);
}

export function percent(value: number | null | undefined, digits = 0): string {
  const n = finite(value);
  if (n === null) return DASH;
  return `${n.toFixed(Math.max(0, Math.min(4, digits)))}%`;
}

export function bytes(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null) return DASH;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(n);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const sign = n < 0 ? '-' : '';
  return `${sign}${unit === 0 ? Math.round(size) : trimZero(size)} ${units[unit]}`;
}

export function contextWindow(value: number | null | undefined): string {
  const n = finite(value);
  if (n === null || n <= 0) return 'Unknown';
  if (n >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  if (n >= 1000) return `${trimZero(n / 1000)}K`;
  return String(Math.round(n));
}

export function timeAgo(at: number | null | undefined): string {
  const n = finite(at);
  if (n === null) return DASH;
  const diff = Date.now() - n;
  if (diff < 0) return 'just now';
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function clockTime(at: number): string {
  const n = finite(at);
  const d = new Date(n === null ? Date.now() : n);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function isoStamp(at: number): string {
  const n = finite(at);
  return new Date(n === null ? Date.now() : n).toISOString();
}

export function throughput(tokensPerSec: number | null | undefined): string {
  const n = finite(tokensPerSec);
  if (n === null) return DASH;
  return `${n < 10 ? trimZero(n) : Math.round(n)} tok/s`;
}

/** Mirrors `maskSecret` in lib/server/upstream.ts so masked keys look identical. */
export function maskKey(key: string): string {
  return maskSecret(key);
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function pluralize(count: number, one: string, many?: string): string {
  return count === 1 ? one : (many ?? `${one}s`);
}

/* Text and class only. Status icons live in StatusPill, which renders them as
   lucide elements — a status must always read as icon + word + color, and a
   glyph in a string can't carry the aria-hidden that pairing needs. */
const STATUS_META: Record<CheckStatus, { label: string; cls: string }> = {
  pass: { label: 'PASS', cls: 'badge-pass' },
  partial: { label: 'Partial', cls: 'badge-partial' },
  fail: { label: 'FAIL', cls: 'badge-fail' },
  skip: { label: 'Skipped', cls: 'badge' },
  running: { label: 'Running', cls: 'badge' },
  pending: { label: 'Pending', cls: 'badge' },
};

export function statusLabel(status: CheckStatus): string {
  return STATUS_META[status]?.label ?? 'Pending';
}

export function statusClass(status: CheckStatus): string {
  return STATUS_META[status]?.cls ?? 'badge';
}

const VERDICTS: Record<AuditVerdict, { label: string; tone: 'pass' | 'partial' | 'fail' | 'unknown' }> = {
  ready: { label: 'Fully compatible', tone: 'pass' },
  partial: { label: 'Partial compatibility', tone: 'partial' },
  incompatible: { label: 'Not compatible', tone: 'fail' },
  unknown: { label: 'Not tested yet', tone: 'unknown' },
};

export function verdictCopy(verdict: AuditVerdict): { label: string; tone: 'pass' | 'partial' | 'fail' | 'unknown' } {
  return VERDICTS[verdict] ?? VERDICTS.unknown;
}

export function prettyJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, val: unknown) => {
        if (typeof val === 'bigint') return `${val.toString()}n`;
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        return val;
      },
      2,
    ) ?? 'undefined';
  } catch {
    return String(value);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  try {
    if (typeof document === 'undefined') return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
