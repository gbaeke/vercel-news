import Link from 'next/link';
import { formatDate } from '../lib/format';
import { ThemeToggle } from './wire-theme';

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const pad3 = (n: number) => String(n).padStart(3, '0');

// The night class lives on <html>, applied by the root layout before first
// paint. It must NOT live here: React rebuilds this node on every client-side
// navigation, which dropped the class and flashed light mode for a frame.
export function WireShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wire">
      <div className="wire-wrap">{children}</div>
    </div>
  );
}

export function WireTopbar({ back = false }: { back?: boolean }) {
  const today = formatDate(new Date().toISOString());
  return (
    <div className="mono wire-topbar">
      {back ? (
        <Link href="/" className="wire-topbar-back">
          <span className="wire-dot" />← Back to the wire
        </Link>
      ) : (
        <span className="wire-topbar-live">
          <span className="wire-dot" />
          Live wire — dispatch open
        </span>
      )}
      <span className="wire-topbar-side">
        <span>{today}</span>
        <ThemeToggle />
      </span>
    </div>
  );
}

export function Wordmark({ size }: { size: 'lg' | 'md' | 'sm' }) {
  const cls = size === 'lg' ? 'wire-wordmark' : size === 'md' ? 'wire-wordmark-md' : 'wire-wordmark-sm';
  const mark = (
    <>
      The AI <em>Wire</em>
    </>
  );
  if (size === 'lg') return <h1 className={cls}>{mark}</h1>;
  return (
    <Link href="/" className={cls}>
      {mark}
    </Link>
  );
}

export function WireFooter({ article = false }: { article?: boolean }) {
  const today = formatDate(new Date().toISOString());
  return (
    <footer className={`wire-footer${article ? ' wire-footer--article' : ''}`}>
      <Wordmark size="sm" />
      <span className="wire-footer-side">
        <span className="mono wire-endline">End of transmission · human-reviewed · {today}</span>
        {/* Staff entrance — the desk itself stays behind the password. */}
        <Link href="/review" className="mono wire-desk-link">
          Desk ↗
        </Link>
      </span>
    </footer>
  );
}
