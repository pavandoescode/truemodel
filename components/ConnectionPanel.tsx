'use client';

import Link from 'next/link';
import { Eye, EyeOff, FolderOpen, Lightbulb, Plug, Zap } from 'lucide-react';
import { getEffectiveEndpoint } from '@/lib/endpoint';
import { maskKey } from '@/lib/format';
import type { ApiError, ProviderConfig } from '@/lib/types';
import styles from './ConnectionPanel.module.css';

export type ConnState = 'idle' | 'connecting' | 'connected' | 'failed';

interface Props {
  config: ProviderConfig;
  onPatch: (patch: Partial<ProviderConfig>) => void;
  isClaudeActive: boolean;
  conn: ConnState;
  detected: string | null;
  connError: ApiError | null;
  showKey: boolean;
  onShowKey: (next: boolean) => void;
  persistKey: boolean;
  onPersistKey: (next: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  profileCount: number;
  onManageProviders: () => void;
}

function ConnBadge({ conn, detected }: { conn: ConnState; detected: string | null }) {
  if (conn === 'connected') {
    return (
      <span className="badge badge-pass">
        <span className="dot dot-pass" /> Connected {detected ? `· ${detected}` : ''}
      </span>
    );
  }
  if (conn === 'connecting') {
    return (
      <span className="badge badge-info">
        <span className="spinner" /> Connecting…
      </span>
    );
  }
  if (conn === 'failed') {
    return (
      <span className="badge badge-fail">
        <span className="dot dot-fail" /> Connection failed
      </span>
    );
  }
  return (
    <span className="badge">
      <span className="dot" /> Offline
    </span>
  );
}

/**
 * Where a run starts: endpoint, key, and the connect action, with the
 * resolved request URL echoed back so there is no guessing about what
 * will actually be called.
 */
export function ConnectionPanel({
  config,
  onPatch,
  isClaudeActive,
  conn,
  detected,
  connError,
  showKey,
  onShowKey,
  persistKey,
  onPersistKey,
  onConnect,
  onDisconnect,
  profileCount,
  onManageProviders,
}: Props) {
  const effectiveUrl = getEffectiveEndpoint(config.endpoint, config.appendV1 ?? true);

  return (
    <div className={styles.wrap}>
      <section className="card anim-fade">
        <div className="card-head row-between">
          <h2 className="card-title">
            <Plug size={16} aria-hidden="true" /> Provider connection
          </h2>
          <ConnBadge conn={conn} detected={detected} />
        </div>

        <form
          className={styles.body}
          onSubmit={(e) => {
            e.preventDefault();
            if (conn !== 'connecting' && config.endpoint.trim() !== '') onConnect();
          }}
        >
          {isClaudeActive && (
            <div className={`${styles.managedHint} anim-fade`}>
              <Zap size={12} aria-hidden="true" />
              Endpoint and key are managed in <Link href="/settings">Settings</Link> while a saved key is active.
            </div>
          )}

          <div className={styles.field}>
            <label className="label" htmlFor="endpoint">Endpoint base URL</label>
            <div className={styles.endpointRow}>
              <input
                id="endpoint"
                className={`input mono ${styles.endpointInput}`}
                value={config.endpoint}
                spellCheck={false}
                placeholder="https://api.lumosel.vip"
                onChange={(e) => onPatch({ endpoint: e.target.value })}
                disabled={isClaudeActive}
                title={isClaudeActive ? 'Managed in Settings while a saved key is active' : undefined}
              />
              <label className={styles.v1Label} title="Append /v1 to the endpoint when it is not already there">
                <input
                  type="checkbox"
                  checked={config.appendV1 ?? true}
                  onChange={(e) => onPatch({ appendV1: e.target.checked })}
                  disabled={isClaudeActive}
                />
                <span>Add /v1</span>
              </label>
            </div>
            {effectiveUrl && (
              <span className="hint">
                Will request:{' '}
                <code className="mono">
                  {effectiveUrl}
                  {/\/v1$/i.test(effectiveUrl) ? '' : '/v1'}/messages
                </code>
              </span>
            )}
          </div>

          <div className={styles.field}>
            <label className="label" htmlFor="apikey">API key</label>
            <div className={styles.keyRow}>
              <input
                id="apikey"
                className="input mono grow"
                type={showKey ? 'text' : 'password'}
                value={showKey || config.apiKey.length === 0 ? config.apiKey : maskKey(config.apiKey)}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                onFocus={() => onShowKey(true)}
                onChange={(e) => onPatch({ apiKey: e.target.value.trim() })}
                disabled={isClaudeActive}
                title={isClaudeActive ? 'Managed in Settings while a saved key is active' : undefined}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-pressed={showKey}
                aria-label={showKey ? 'Hide key' : 'Show key'}
                onClick={() => onShowKey(!showKey)}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <span className="hint">
              🔒 Your key is only proxied through this app's server for the request you run — never stored,
              logged, or sent to any third party. Use “Remember key” below only on a device you trust.
            </span>
          </div>

          <div className={styles.actions}>
            {conn === 'connected' ? (
              <button
                type="button"
                className="btn"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDisconnect();
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={conn === 'connecting' || config.endpoint.trim() === ''}
              >
                {conn === 'connecting' ? <span className="spinner" aria-hidden="true" /> : <Plug size={15} aria-hidden="true" />}
                {conn === 'connecting' ? 'Connecting…' : 'Connect & discover'}
              </button>
            )}
            <label className={styles.persist}>
              <input type="checkbox" checked={persistKey} onChange={(e) => onPersistKey(e.target.checked)} />
              <span>Remember key in this browser</span>
            </label>
          </div>

          {connError && (
            <div className={`${styles.errorBox} anim-fade`} role="alert">
              <strong className={styles.errorTitle}>{connError.title}</strong>
              <span className={styles.errorMessage}>{connError.message}</span>
              {connError.suggestions && connError.suggestions.length > 0 && (
                <div className={styles.suggestions}>
                  {connError.suggestions.map((sugg, idx) => (
                    <span key={idx} className={styles.suggestion}>
                      <Lightbulb size={13} aria-hidden="true" /> {sugg}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </section>

      <button type="button" className={`btn btn-ghost ${styles.manage}`} onClick={onManageProviders}>
        <FolderOpen size={15} aria-hidden="true" /> Manage saved providers
        {profileCount > 0 && <span className="badge">{profileCount}</span>}
      </button>
    </div>
  );
}
