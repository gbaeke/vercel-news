import Link from 'next/link';
import { WireShell, WireTopbar, WireFooter, Wordmark } from '../../wire';

export default function ArticleNotFound() {
  return (
    <WireShell>
      <header className="wire-header wire-header--article">
        <WireTopbar back />
        <div className="wire-masthead wire-masthead--compact">
          <Wordmark size="md" />
          <span className="mono wire-dispatch-no">Not on the wire</span>
        </div>
      </header>
      <p className="mono wire-empty">
        This story doesn&apos;t exist or was taken down. <Link href="/">Back to the wire</Link>.
      </p>
      <WireFooter article />
    </WireShell>
  );
}
