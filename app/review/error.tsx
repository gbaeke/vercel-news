'use client';

import { useEffect } from 'react';

export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[desk] page render failed', error);
  }, [error]);

  return (
    <div className="shell">
      <div className="empty-state">
        <span className="meta">desk unavailable</span>
        <p>The editor&apos;s desk could not load. This is usually temporary; your saved articles were not changed.</p>
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--primary" onClick={reset}>
            Try again
          </button>
          <a href="/" className="btn">
            Back to the wire
          </a>
        </div>
      </div>
    </div>
  );
}
