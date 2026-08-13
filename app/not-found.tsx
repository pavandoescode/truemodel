import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="card" style={{ margin: 'var(--s-10) auto', maxWidth: 480 }}>
      <div className="card-head">
        <h2 className="card-title">
          <Compass size={18} /> No such page
        </h2>
      </div>
      <div className="card-body col">
        <p className="muted">The validator is a single dashboard — every feature lives behind the sidebar.</p>
        <Link className="btn btn-primary" href="/">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
