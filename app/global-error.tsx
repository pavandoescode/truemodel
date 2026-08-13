'use client';

import './globals.css';
import { AlertTriangle } from 'lucide-react';

/** Last-resort boundary: replaces <html> when the root layout itself fails. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" data-theme="lumosel">
      <body>
        <div className="card" style={{ margin: 'var(--s-10) auto', maxWidth: 560 }}>
          <div className="card-head">
            <h2 className="card-title">
              <AlertTriangle size={16} aria-hidden="true" /> The app failed to start
            </h2>
          </div>
          <div className="card-body col">
            <p className="muted">
              The root layout threw before the dashboard mounted. Stored settings and profiles are still in this
              browser&apos;s LocalStorage.
            </p>
            <pre className="codeblock codeblock-wrap" style={{ maxHeight: 200 }}>
              {error.message || 'Unknown error'}
            </pre>
            <button type="button" className="btn btn-primary" onClick={reset}>
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
