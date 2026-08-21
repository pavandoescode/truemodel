'use client';

import { ArrowRight } from 'lucide-react';
import { ms } from '@/lib/format';
import { VERDICT_BLURB, VERDICT_TONE } from '@/lib/identity';
import { monthLabel } from '@/lib/registry';
import { StatusPill, type ResultStatus } from './StatusPill';
import { IdentityPill } from './IdentityPill';
import type { ApiError, IdentityReport, IdentitySignal, ModelInfo } from '@/lib/types';
import styles from './ModelTable.module.css';

export interface RowResult {
  status: ResultStatus;
  latencyMs?: number | null;
  tokensPerSec?: number | null;
  text?: string;
  error?: ApiError | null;
}

/** Verdicts meaning the served model was not the one advertised. Kept in sync
 *  with the same set in app/page.tsx. */
const SUSPECT_VERDICTS = new Set<IdentityReport['verdict']>([
  'wrong-tier',
  'different-vendor',
  'likely-mismatch',
  'mismatch',
]);

interface RowProps {
  model: ModelInfo;
  result: RowResult | undefined;
  identity: IdentityReport | undefined;
  identityRunning: boolean;
  showIdentity: boolean;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string, next: boolean) => void;
}

/** One labelled bar of a comparison meter. */
function MeterBar({
  label,
  value,
  max,
  alt,
  display,
}: {
  label: string;
  value: number;
  max: number;
  alt?: boolean;
  display?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={styles.meterRow}>
      <span>{label}</span>
      <span className={styles.meterTrack}>
        <span className={`${styles.meterFill} ${alt ? styles.meterFillAlt : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.meterValue}>{display ?? value.toLocaleString('en-US')}</span>
    </div>
  );
}

/**
 * Raw-measurement comparison for signals whose evidence carries two comparable
 * numbers (measured vs reference). Numbers stay in the detail sentence — the
 * bars are a glance aid, never the only channel.
 */
function SignalMeter({ signal }: { signal: IdentitySignal }) {
  const evidence = signal.evidence as Record<string, unknown> | undefined;
  if (!evidence) return null;

  if (signal.id === 'tokenizer-fingerprint' && typeof evidence.count === 'number') {
    const count = evidence.count as number;
    const baseline = typeof evidence.baseline === 'number' ? (evidence.baseline as number) : null;
    if (baseline === null) return null;
    const max = Math.max(count, baseline);
    return (
      <div className={styles.meterList}>
        <MeterBar label="this model" value={count} max={max} />
        <MeterBar label="cohort median" value={baseline} max={max} alt />
      </div>
    );
  }

  if (signal.id === 'output-ceiling' && typeof evidence.measuredCeiling === 'number' && typeof evidence.expected === 'number') {
    const measured = evidence.measuredCeiling as number;
    const expected = evidence.expected as number;
    if (expected === 0) return null;
    const max = Math.max(measured, expected);
    return (
      <div className={styles.meterList}>
        <MeterBar label="measured cap" value={measured} max={max} />
        <MeterBar label="advertised cap" value={expected} max={max} alt />
      </div>
    );
  }

  if (
    (signal.id === 'random-number-fingerprint' || signal.id === 'style-fingerprint') &&
    typeof evidence.divergence === 'number' &&
    typeof evidence.threshold === 'number'
  ) {
    const divergence = evidence.divergence as number;
    const threshold = evidence.threshold as number;
    const max = Math.max(divergence, threshold) * 1.1;
    return (
      <div className={styles.meterList}>
        <MeterBar label="divergence" value={Number(divergence.toFixed(2))} max={max} />
        <MeterBar label="cohort threshold" value={Number(threshold.toFixed(2))} max={max} alt />
      </div>
    );
  }

  if (signal.id === 'knowledge-cutoff' && typeof evidence.knownThrough === 'number') {
    const knownThrough = evidence.knownThrough as number;
    const window = evidence.window as { from: number; to: number } | undefined;
    if (!window) return null;
    const max = Math.max(knownThrough, window.to);
    return (
      <div className={styles.meterList}>
        <MeterBar label="knows through" value={knownThrough} max={max} display={monthLabel(knownThrough)} />
        <MeterBar label="window ends" value={window.to} max={max} alt display={monthLabel(window.to)} />
      </div>
    );
  }

  return null;
}

/**
 * One reading. The row is a grid, not a flex bar, so latency and throughput
 * land in the same columns on every line — the numbers are meant to be
 * compared down the page, not read one at a time.
 */
function ModelRow({
  model,
  result,
  identity,
  identityRunning,
  showIdentity,
  checked,
  disabled,
  onToggle,
}: RowProps) {
  return (
    <li className={styles.row} data-tone={result?.status} data-identity={showIdentity ? 'on' : undefined}>
      <label className={styles.rowLeft}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={checked}
          onChange={(e) => onToggle(model.id, e.target.checked)}
          disabled={disabled}
          aria-label={`Select ${model.id}`}
        />
        <span className={`${styles.modelId} mono`}>{model.id}</span>
        {model.family && <span className="badge badge-info">{model.family}</span>}
        {/* A substitution is the headline finding, so it belongs on the row
            itself rather than behind a disclosure the user may never open.
            Shown for every suspicious verdict: with the served id when the
            endpoint revealed one, otherwise a muted "unconfirmed" note so the
            row never looks clean when the verdict isn't. */}
        {identity && SUSPECT_VERDICTS.has(identity.verdict) && (
          identity.attribution?.servedModelId ? (
            <span className={styles.servedAs} title={`Actually served: ${identity.attribution.servedModelId}`}>
              <ArrowRight size={12} aria-hidden="true" />
              <span className="mono">served: {identity.attribution.servedModelId}</span>
            </span>
          ) : (
            <span className={styles.servedUnknown} title="The endpoint did not reveal which model actually answered.">
              served model unconfirmed
            </span>
          )
        )}
      </label>

      <div className={styles.readings}>
        <span className={`${styles.cellNum} tnum`}>
          {result?.latencyMs ? ms(result.latencyMs) : <span className={styles.dash}>—</span>}
        </span>
        <span className={`${styles.cellNum} tnum`}>
          {result?.tokensPerSec ? `${result.tokensPerSec.toFixed(1)} t/s` : <span className={styles.dash}>—</span>}
        </span>

        <div className={styles.cellStatus}>
          <StatusPill status={result?.status ?? 'pending'} />
        </div>

        {showIdentity && (
          <div className={styles.cellIdentity}>
            {identityRunning ? (
              <IdentityPill verdict="ambiguous" running />
            ) : identity ? (
              <IdentityPill verdict={identity.verdict} confidence={identity.confidence} />
            ) : (
              <span className={styles.dash}>—</span>
            )}
          </div>
        )}
      </div>

      {/* The pill names the verdict; this line says what it means in plain
          words on the row itself, so a non-expert reads the finding without a
          hover — tooltips never fire on touch. Full-width beneath the reading
          columns because a sentence won't fit the pill's column. Tone tints
          the fail/warn cases so mismatches draw the eye, but the words carry
          the meaning, never the colour alone. */}
      {showIdentity && identity && !identityRunning && (
        <p className={styles.verdictBlurb} data-tone={VERDICT_TONE[identity.verdict]}>
          {VERDICT_BLURB[identity.verdict]}
        </p>
      )}

      {(result?.text || result?.error) && (
        <details className={styles.accordion}>
          <summary className={`${styles.summary} ${result.error ? styles.failText : styles.okText}`}>
            <span className={styles.summaryText}>
              {result.error ? result.error.message : result.text}
            </span>
          </summary>
        </details>
      )}

      {/* Signals are the whole point of the identity check: the verdict is a
          summary, and the user needs to see which evidence produced it. */}
      {identity && identity.signals.length > 0 && (
        <details className={styles.accordion}>
          <summary className={`${styles.summary} ${styles.okText}`}>
            <span className={styles.summaryText}>
              Identity evidence — {identity.signals.filter((s) => s.status === 'pass').length} of{' '}
              {identity.signals.filter((s) => s.status !== 'skip').length} checks passed
              {identity.tokenizerCount !== null ? ` · ${identity.tokenizerCount} tokens` : ''}
            </span>
          </summary>
          <ul className={styles.signalList}>
            {identity.signals.map((s) => (
              <li key={s.id} className={styles.signal} data-status={s.status} data-weight={s.weight}>
                <span className={styles.signalLabel}>
                  {s.label}
                  {/* A provider-level finding must not read as a failed model. */}
                  {s.weight === 'context' && s.status !== 'skip' && (
                    <span className={styles.signalWeight} title="About the provider, not scored against this model">
                      context
                    </span>
                  )}
                </span>
                <span className={styles.signalDetail}>{s.detail}</span>
                <SignalMeter signal={s} />
              </li>
            ))}
          </ul>

          {/* "Then which model is it?" — kept visually apart from the signals
              above because this part is partly inference, and the distinction
              matters when someone acts on it. */}
          {identity.attribution && (
            <div className={styles.attribution}>
              <p className={styles.attributionSummary}>{identity.attribution.summary}</p>

              {identity.attribution.servedModelId && (
                <p className={styles.attributionFact}>
                  Model served: <strong className="mono">{identity.attribution.servedModelId}</strong>
                  {identity.attribution.servedFamily && ` (${identity.attribution.servedFamily}`}
                  {identity.attribution.servedFamily && identity.attribution.servedVendor
                    ? `, ${identity.attribution.servedVendor})`
                    : identity.attribution.servedFamily && ')'}
                </p>
              )}

              {identity.advertised && (
                <p className={styles.attributionFact}>
                  Sold as:{' '}
                  <strong>
                    {identity.advertised.vendor} {identity.advertised.family}
                  </strong>{' '}
                  · {identity.advertised.context.toLocaleString('en-US')} context ·{' '}
                  {identity.advertised.output.toLocaleString('en-US')} output
                </p>
              )}

              {identity.attribution.measuredCeiling !== null && (
                <p className={styles.attributionFact}>
                  Measured output ceiling:{' '}
                  <strong className="tnum">
                    {identity.attribution.measuredCeiling.toLocaleString('en-US')}
                  </strong>{' '}
                  tokens
                  {identity.attribution.candidateFamilies.length > 0 &&
                    ` · matches ${identity.attribution.candidateFamilies.join(', ')}`}
                </p>
              )}

              {/* "Then which model is it?" — every measured fact pooled into a
                  ranked shortlist. Relative scores, not probabilities: the
                  point is to name plausible suspects, not to convict one. */}
              {identity.attribution.rankedCandidates.length > 0 && (
                <>
                  <p className={styles.attributionLabel}>Closest registry families</p>
                  <ul className={styles.candidateList}>
                    {identity.attribution.rankedCandidates.map((c) => (
                      <li key={`${c.vendor}-${c.family}`} className={styles.candidate}>
                        <strong>
                          {c.vendor} {c.family}
                        </strong>{' '}
                        <span className={styles.candidateScore}>{c.score}%</span>
                        {identity.advertised && c.family === identity.advertised.family && (
                          <span className={styles.candidateAdvertised}> — as sold</span>
                        )}
                        {c.why.length > 0 && <span className={styles.candidateWhy}> · {c.why.join('; ')}</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {identity.attribution.quotes.length > 0 && (
                <>
                  <p className={styles.attributionLabel}>In its own words</p>
                  <ul className={styles.quoteList}>
                    {identity.attribution.quotes.map((q, i) => (
                      <li key={i} className={styles.quote}>
                        {q}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {identity.attribution.vendorMentions.length > 1 && (
                <p className={styles.attributionFact}>
                  Named more than one vendor across runs: {identity.attribution.vendorMentions.join(', ')}.
                  Inconsistency here is itself a signal.
                </p>
              )}

              <p className={styles.attributionCaveat}>
                {identity.attribution.nameSource === 'response-model' ||
                identity.attribution.nameSource === 'error-message'
                  ? 'The served model name comes from the endpoint itself, not from asking the model. A vendor name, where shown, is only what the model said.'
                  : 'No source named the model served, so nothing here confirms the label — a cheaper model from the same vendor would look identical. A vendor name is only what the model said.'}
              </p>
            </div>
          )}
        </details>
      )}

      {identity?.fingerprint && identity.fingerprint.parsed > 0 && (
        <p className={styles.fingerprintReadout}>
          Random-number distribution:{' '}
          {identity.fingerprint.divergence !== null && identity.fingerprint.threshold !== null
            ? `divergence ${identity.fingerprint.divergence.toFixed(2)} vs cohort threshold ${identity.fingerprint.threshold.toFixed(2)}`
            : 'recorded, no cohort baseline to compare'}
          {` (${identity.fingerprint.parsed}/${identity.fingerprint.attempted} samples)`}
        </p>
      )}
    </li>
  );
}

interface Props {
  models: ModelInfo[];
  results: Record<string, RowResult>;
  identities?: Record<string, IdentityReport>;
  identityRunning?: Record<string, boolean>;
  /** Adds the verdict column; off until an identity check has been started. */
  showIdentity?: boolean;
  checked: Record<string, boolean>;
  disabled: boolean;
  onToggle: (id: string, next: boolean) => void;
}

export function ModelTable({
  models,
  results,
  identities,
  identityRunning,
  showIdentity = false,
  checked,
  disabled,
  onToggle,
}: Props) {
  return (
    <ul className={styles.list}>
      {models.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          result={results[model.id]}
          identity={identities?.[model.id]}
          identityRunning={!!identityRunning?.[model.id]}
          showIdentity={showIdentity}
          checked={!!checked[model.id]}
          disabled={disabled}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}
