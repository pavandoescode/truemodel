'use client';

import { CheckCircle2, XCircle, AlertTriangle, Loader2, Minus } from 'lucide-react';
import styles from './StatusPill.module.css';

export type ResultStatus = 'pending' | 'running' | 'pass' | 'partial' | 'fail';

const SPEC: Record<ResultStatus, { label: string; Icon: typeof CheckCircle2 }> = {
  pass: { label: 'Pass', Icon: CheckCircle2 },
  fail: { label: 'Fail', Icon: XCircle },
  partial: { label: 'Partial', Icon: AlertTriangle },
  running: { label: 'Testing', Icon: Loader2 },
  pending: { label: 'Not tested', Icon: Minus },
};

/**
 * The one place a result status is rendered.
 *
 * Status always ships as icon + word + color, never color alone: the
 * pass green and fail red are near-indistinguishable under deuteranopia
 * (OKLab ΔE 2.1), so the glyph and the label carry the meaning and the
 * color is only reinforcement.
 */
export function StatusPill({ status }: { status: ResultStatus }) {
  const { label, Icon } = SPEC[status];
  return (
    <span className={styles.pill} data-status={status}>
      <Icon
        size={13}
        aria-hidden="true"
        className={status === 'running' ? styles.spin : undefined}
      />
      <span>{label}</span>
    </span>
  );
}
