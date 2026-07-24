import Link from 'next/link';
import { SITE_NAME, SITE_TAGLINE } from '../lib/config';
import { formatDate } from '../lib/format';
import type { Article } from '../lib/types';

export function Masthead({ dateline }: { dateline?: string }) {
  return (
    <header className="masthead">
      <div className="masthead-row">
        <Link href="/" className="wordmark">
          The AI <em>Wire</em>
        </Link>
        <span className="dateline">{dateline ?? SITE_TAGLINE}</span>
      </div>
    </header>
  );
}

export function WireLine({ article }: { article: Article }) {
  return (
    <p className="wire-line">
      <span>{article.source_feed}</span>
      <span className="sep">▸</span>
      {article.tags?.primary && (
        <>
          <span>{article.tags.primary}</span>
          <span className="sep">·</span>
        </>
      )}
      <span>filed {formatDate(article.published_at ?? article.created_at)}</span>
    </p>
  );
}

const CHIP_CLASS: Record<string, string> = {
  in_review: 'chip--review',
  failed: 'chip--failed',
  published: 'chip--live',
  declined: 'chip--dead',
};

const CHIP_LABEL: Record<string, string> = {
  new: 'ingested',
  scraped: 'scraped',
  tagged: 'tagged',
  written: 'written',
  in_review: 'in review',
  rewrite_requested: 'rewriting',
  image_requested: 'new image',
  approved: 'approved',
  published: 'live',
  declined: 'declined',
  failed: 'failed',
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${CHIP_CLASS[status] ?? 'chip--flight'}`}>{CHIP_LABEL[status] ?? status}</span>;
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p className="meta">
        {SITE_NAME} — {SITE_TAGLINE}. Every story is reviewed by a human before it appears here.
      </p>
    </footer>
  );
}
