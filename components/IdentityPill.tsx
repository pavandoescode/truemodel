'use client';

import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, Loader2 } from 'lucide-react';
import { VERDICT_BLURB, VERDICT_LABEL, VERDICT_TONE } from '@/lib/identity';
import type { IdentityVerdict } from '@/lib/types';
import styles from './StatusPill.module.css';

/** Which shield each verdict wears. Colour comes from the shared VERDICT_TONE. */
const ICON: Record<IdentityVerdict, typeof ShieldCheck> = {
  'matches-advertised': ShieldCheck,
  'likely-advertised': ShieldCheck,
  // A real model from the right vendor, just not the tier that was ordered — a
  // billing problem rather than a fake, so it gets the alert icon, not the X.
  'wrong-tier': ShieldAlert,
  'different-vendor': ShieldX,
  ambiguous: ShieldQuestion,
  'likely-mismatch': ShieldAlert,
  mismatch: ShieldX,
  error: ShieldQuestion,
};

/**
 * Identity verdict, rendered on the same rules as StatusPill: icon + words +
 * colour, never colour alone. The confidence number is deliberately part of
 * the label — "likely" without a number invites over-reading the result.
 */
export function IdentityPill({
  verdict,
  confidence,
  running,
}: {
  verdict: IdentityVerdict;
  confidence?: number;
  running?: boolean;
}) {
  if (running) {
    return (
      <span className={styles.pill} data-status="running">
        <Loader2 size={13} aria-hidden="true" className={styles.spin} />
        <span>Probing</span>
      </span>
    );
  }
  const Icon = ICON[verdict];
  const tone = VERDICT_TONE[verdict];
  const label = VERDICT_LABEL[verdict];
  return (
    <span
      className={styles.pill}
      data-status={tone}
      title={`${label}${confidence ? ` — ${confidence}% confidence` : ''}. ${VERDICT_BLURB[verdict]}`}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
      {/* A visible number, not just a tooltip: "82%" reads as "probably",
          "40%" reads as "weak", and that difference belongs on the row. */}
      {typeof confidence === 'number' && confidence > 0 && (
        <span className={styles.pillConfidence}>{confidence}%</span>
      )}
    </span>
  );
}
