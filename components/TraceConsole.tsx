'use client';

import { useMemo, type ReactNode } from 'react';
import { Activity, ArrowRight, Loader2, Trash2 } from 'lucide-react';
import { clockTime, ms } from '@/lib/format';
import { legBreakdown, upstreamHost, type RequestTrace } from '@/lib/requestTrace';
import styles from './TraceConsole.module.css';

/**
 * Live request trace: every provider call this app makes, with its two hops
 * spelled out — browser ↔ this app's route, and the route ↔ the provider the
 * route actually called (resolved URL, status, server-measured latency), plus
 * what came back. The point is that nothing about where a request went is
 * implicit: a gateway rewriting a model id shows up here as the URL it really
 * hit. Auth headers arrive pre-masked from the route; the API key never
 * enters this panel.
 */
export function TraceConsole({ traces, onClear }: { traces: readonly RequestTrace[]; onClear: () => void }) {
  // Newest first: the interesting request is almost always the latest one.
  const ordered = useMemo(() => [...traces].reverse(), [traces]);
  const inFlight = traces.filter((t) => !t.done).length;

  if (traces.length === 0) return null;

  return (
    <section className={styles.panel} aria-label="Request trace">
      <header className={styles.head}>
        <Activity size={14} aria-hidden="true" />
        <span className={styles.headTitle}>Request trace</span>
        <span className="subtle">
          {traces.length} {traces.length === 1 ? 'request' : 'requests'}
          {inFlight > 0 && (
            <span className={styles.inFlight}>
              <Loader2 size={11} aria-hidden="true" className={styles.spin} /> {inFlight} in flight
            </span>
          )}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} title="Clear the trace list">
          <Trash2 size={13} aria-hidden="true" />
          Clear
        </button>
      </header>

      <ul className={styles.list}>
        {ordered.map((t) => (
          <TraceRow key={t.id} trace={t} />
        ))}
      </ul>

      <p className={styles.note}>
        Two hops per request: your browser → this app&apos;s route (keys stay server-side), then the route → the
        provider URL shown. Request headers are displayed as the route masked them; the key itself never appears.
      </p>
    </section>
  );
}

function TraceRow({ trace }: { trace: RequestTrace }) {
  const { appLegMs, upstreamLegMs } = legBreakdown(trace);
  const host = upstreamHost(trace);
  const hops = trace.redirectChain ?? [];
  const hopHosts = hops
    .map((h) => hostOf(h.from) ?? h.from)
    .concat(host ?? (hops.length ? hostOf(hops[hops.length - 1]!.to) ?? hops[hops.length - 1]!.to : []));

  return (
    <li className={styles.row} data-tone={!trace.done ? 'running' : trace.ok ? 'ok' : 'fail'}>
      <details className={styles.details}>
        <summary className={styles.summary}>
          <span className={styles.status} title={trace.done ? `HTTP ${trace.upstreamStatus ?? '—'}` : 'In flight'}>
            {trace.done ? (trace.upstreamStatus ?? '—') : <Loader2 size={11} aria-hidden="true" className={styles.spin} />}
          </span>
          <span className={`${styles.route} mono`}>
            {trace.method} {trace.path}
          </span>
          {trace.model && (
            <span className={`${styles.model} mono`} title={`Model: ${trace.model}`}>
              {trace.model}
            </span>
          )}
          {hops.length > 0 && (
            <span
              className={styles.redirectChip}
              title={`Followed ${hops.length} redirect${hops.length === 1 ? '' : 's'}: ${hopHosts.join(' → ')}`}
            >
              ↻ {hops.length}
            </span>
          )}
          <span className={styles.legs}>
            {!trace.done ? (
              'in flight…'
            ) : (
              <>
                <span title="Browser ↔ this app's route (including the route's own overhead)">
                  you↔app {ms(appLegMs)}
                </span>
                <ArrowRight size={11} aria-hidden="true" />
                <span title="This app's route ↔ the provider, measured server-side">
                  app↔provider {ms(upstreamLegMs)}
                </span>
                {host && <span className={styles.host}>→ {host}</span>}
              </>
            )}
          </span>
          <span className={`${styles.time} tnum`}>{clockTime(trace.at)}</span>
        </summary>

        <div className={styles.body}>
          {hops.length > 0 && (
            <TraceFact label="Redirect trail">
              <ol className={styles.hopList}>
                {hops.map((h, i) => (
                  <li key={i} className={styles.hop}>
                    <span className="mono">{hostOf(h.from) ?? h.from}</span>
                    <span className={styles.hopArrow}>—{h.status}→</span>
                    <span className="mono">{hostOf(h.to) ?? h.to}</span>
                    {h.authDropped && (
                      <span className={styles.authDropped} title="Credential headers were not forwarded to the redirect target">
                        key not forwarded
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </TraceFact>
          )}

          <TraceFact label="Went to">
            {trace.upstreamUrl ? (
              <a className={`${styles.url} mono`} href={trace.upstreamUrl} target="_blank" rel="noreferrer noopener">
                {trace.upstreamUrl}
              </a>
            ) : (
              <span className="subtle">never resolved — the request failed before the route could call the provider</span>
            )}
          </TraceFact>

          {trace.sentHeaders && Object.keys(trace.sentHeaders).length > 0 && (
            <TraceFact label="Headers sent (masked)">
              <ul className={styles.headerList}>
                {Object.entries(trace.sentHeaders).map(([k, v]) => (
                  <li key={k}>
                    <span className="mono">{k}</span>: <span className="mono subtle">{v}</span>
                  </li>
                ))}
              </ul>
            </TraceFact>
          )}

          {trace.responseHeaders && Object.keys(trace.responseHeaders).length > 0 && (
            <TraceFact label="Response headers">
              <ul className={styles.headerList}>
                {Object.entries(trace.responseHeaders).map(([k, v]) => (
                  <li key={k}>
                    <span className="mono">{k}</span>: <span className="mono subtle">{v}</span>
                  </li>
                ))}
              </ul>
            </TraceFact>
          )}

          {trace.usage && (
            <TraceFact label="Usage">
              {trace.usage.input_tokens ?? '—'} in · {trace.usage.output_tokens ?? '—'} out
              {trace.eventCount !== null && ` · ${trace.eventCount} stream events`}
            </TraceFact>
          )}

          {trace.error && (
            <TraceFact label="Error">
              <span className={styles.errorText}>
                {trace.error.message}
              </span>
            </TraceFact>
          )}

          {trace.preview && (
            <TraceFact label="Response body (start)">
              <pre className={`${styles.preview} mono`}>{trace.preview}</pre>
            </TraceFact>
          )}
        </div>
      </details>
    </li>
  );
}

function TraceFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <div className={styles.factBody}>{children}</div>
    </div>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
