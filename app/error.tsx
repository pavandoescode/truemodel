'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Route-level error boundary. A panel that throws must not take the whole
 * dashboard with it — the console and connection state are the valuable part.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surfaced in the browser console only. No telemetry leaves this machine.
    console.error('[provider-validator] render error', error);
  }, [error]);

  return (
    <div className="card" style={{ margin: 'var(--s-8) auto', maxWidth: 620 }}>
      <div className="card-head">
        <div>
          <h2 className="card-title">
            <AlertTriangle size={18} /> Something in the dashboard crashed
          </h2>
          <p className="card-sub">Your provider config and saved profiles are untouched.</p>
        </div>
      </div>
      <div className="card-body col">
        <p className="muted">
          This is a UI fault, not a provider failure — nothing was sent anywhere. Retrying re-renders the panel; a
          reload rebuilds the whole app from stored settings.
        </p>
        <pre className="codeblock codeblock-wrap" style={{ maxHeight: 180 }}>
          {error.message || 'Unknown error'}
          {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>
      </div>
    </div>
  );
}
