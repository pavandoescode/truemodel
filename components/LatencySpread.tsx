'use client';

import { useMemo, useState } from 'react';
import { ms } from '@/lib/format';
import styles from './LatencySpread.module.css';

export interface LatencyPoint {
  id: string;
  latencyMs: number;
}

interface Props {
  points: LatencyPoint[];
}

const W = 1000; // viewBox units; the SVG scales to its container
const H = 64;
const PAD = 8;
const AXIS_Y = 38;

/** Ramp step (1..4) for a position already normalised to 0..1. */
function rampStep(t: number): 1 | 2 | 3 | 4 {
  if (t < 0.25) return 1;
  if (t < 0.5) return 2;
  if (t < 0.75) return 3;
  return 4;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The signature element: every tested model as one tick on a fast→slow
 * axis, with the median marked. Answers "is this endpoint any good?" at
 * a glance — clustering, outliers, and spread all read at once, which a
 * single average latency number cannot show.
 *
 * Deliberately hand-built SVG: this is a 1-D strip plot, and pulling in
 * a charting library for it would be more code, not less.
 *
 * Latency is a *magnitude*, so it is encoded on a sequential one-hue
 * ramp (light = fast, dark = slow), never on the pass/fail status hues.
 */
export function LatencySpread({ points }: Props) {
  const [hover, setHover] = useState<LatencyPoint | null>(null);

  const model = useMemo(() => {
    const valid = points.filter((p) => Number.isFinite(p.latencyMs) && p.latencyMs > 0);
    if (valid.length === 0) return null;

    const values = valid.map((p) => p.latencyMs).sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];

    // Log scale: latency spans hundreds of ms to tens of seconds, and a
    // linear axis collapses the fast cluster into a single blob.
    const lo = Math.log(min);
    const hi = Math.log(max);
    const span = hi - lo || 1;
    // Normalised 0..1 position. Both the x coordinate and the ramp step read
    // from it, so a tick's color always agrees with where it sits on the axis.
    const t = (v: number) => (max === min ? 0 : (Math.log(v) - lo) / span);
    const x = (v: number) => PAD + t(v) * (W - PAD * 2);

    return { valid, min, max, med: median(values), x, t };
  }, [points]);

  if (!model) return null;

  const { valid, min, max, med, x, t } = model;

  return (
    <figure className={styles.wrap}>
      <figcaption className={styles.caption}>
        <span className="label-instrument">Latency spread</span>
        <span className={styles.count}>
          {valid.length} {valid.length === 1 ? 'reading' : 'readings'} · median{' '}
          <span className="tnum">{ms(med)}</span>
        </span>
      </figcaption>

      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Latency spread across ${valid.length} models. Fastest ${ms(min)}, median ${ms(med)}, slowest ${ms(max)}.`}
      >
        {/* Axis rule */}
        <line
          x1={PAD}
          y1={AXIS_Y}
          x2={W - PAD}
          y2={AXIS_Y}
          stroke="var(--chart-grid)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* Median marker, behind the ticks */}
        <line
          x1={x(med)}
          y1={AXIS_Y - 20}
          x2={x(med)}
          y2={AXIS_Y + 8}
          stroke="var(--fg-subtle)"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />

        {valid.map((p) => {
          const active = hover?.id === p.id;
          return (
            <line
              key={p.id}
              x1={x(p.latencyMs)}
              y1={AXIS_Y - 14}
              x2={x(p.latencyMs)}
              y2={AXIS_Y}
              stroke={`var(--latency-${rampStep(t(p.latencyMs))})`}
              strokeWidth={active ? 6 : 3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${p.id} — ${ms(p.latencyMs)}`}</title>
            </line>
          );
        })}
      </svg>

      <div className={styles.scale}>
        <span className="tnum">{ms(min)}</span>
        <span className={styles.scaleMid}>median <span className="tnum">{ms(med)}</span></span>
        <span className="tnum">{ms(max)}</span>
      </div>

      {/* Live readout — hovering a tick names the model without a
          floating tooltip that would clip inside the panel. */}
      <div className={styles.readout} aria-live="polite">
        {hover ? (
          <>
            <span className={styles.readoutId}>{hover.id}</span>
            <span className="tnum">{ms(hover.latencyMs)}</span>
          </>
        ) : (
          <span className={styles.readoutHint}>Hover a tick to identify the model</span>
        )}
      </div>
    </figure>
  );
}
