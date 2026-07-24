import Link from 'next/link';
import { formatDate } from '../lib/format';
import { ThemeToggle } from './wire-theme';

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const pad3 = (n: number) => String(n).padStart(3, '0');

// Applies the persisted night theme before first paint (no flash); the class
// survives hydration via suppressHydrationWarning on the wrapper.
const THEME_SCRIPT = `try{if(localStorage.getItem('aiwire-theme')==='night')document.getElementById('wire-root').classList.add('night')}catch(e){}`;

export function WireShell({ children }: { children: React.ReactNode }) {
  return (
    <div id="wire-root" className="wire" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
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
      <span className="mono wire-endline">End of transmission · human-reviewed · {today}</span>
    </footer>
  );
}
