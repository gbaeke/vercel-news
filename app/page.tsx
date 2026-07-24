import Link from 'next/link';
import { getPublishedArticles } from '../lib/publicQueries';
import { getTags } from '../lib/tags';
import { formatDate } from '../lib/format';
import { SITE_TAGLINE } from '../lib/config';
import { WireShell, WireTopbar, WireFooter, Wordmark, pad2, pad3 } from './wire';
import type { Article } from '../lib/types';

// Reading searchParams makes this page render per-request; at personal
// traffic levels the spec explicitly blesses dynamic rendering (§9).
export const dynamic = 'force-dynamic';

function Kicker({ article }: { article: Article }) {
  return (
    <div className="mono kicker wire-kicker-row">
      <span>
        {article.source_feed} ▸ {article.tags?.primary}
      </span>
      <span className="dim">· filed {formatDate(article.published_at ?? article.created_at)}</span>
    </div>
  );
}

function matchesTag(article: Article, tag: string): boolean {
  return article.tags?.primary === tag || (article.tags?.secondary ?? []).includes(tag);
}

export default async function HomePage({ searchParams }: { searchParams: { tag?: string } }) {
  const [articles, allTags] = await Promise.all([getPublishedArticles(), getTags()]);
  const active = allTags.includes(searchParams.tag ?? '') ? searchParams.tag! : 'all';

  // Newest article is the lead; dispatch numbers count up from the oldest.
  const total = articles.length;
  const lead = articles[0] ?? null;
  const rows = articles
    .slice(1)
    .map((article, i) => ({ article, no: total - 1 - i }))
    .filter(({ article }) => active === 'all' || matchesTag(article, active));

  return (
    <WireShell>
      <header className="wire-header">
        <WireTopbar />
        <div className="wire-masthead">
          <Wordmark size="lg" />
          <p className="mono wire-tagline">{SITE_TAGLINE}. Every story reviewed before it hits the wire.</p>
        </div>
        <nav className="mono wire-filters" aria-label="Filter by tag">
          <span className="wire-filters-label">Filter /</span>
          <Link href="/" className={`pill${active === 'all' ? ' on' : ''}`}>
            all
          </Link>
          {allTags.map((tag) => (
            <Link key={tag} href={`/?tag=${tag}`} className={`pill${active === tag ? ' on' : ''}`}>
              {tag}
            </Link>
          ))}
        </nav>
      </header>

      {!lead && (
        <p className="mono wire-empty">Wire idle — nothing on the wire yet. Approved stories appear here.</p>
      )}

      {lead && (
        <section className="wire-lead">
          <div className="wire-lead-grid">
            <article className="wire-lead-body">
              <div className="mono kicker wire-kicker-row">
                <span className="wire-badge">Lead dispatch</span>
                <span>
                  {lead.source_feed} ▸ {lead.tags?.primary}
                </span>
                <span className="dim">· filed {formatDate(lead.published_at ?? lead.created_at)}</span>
              </div>
              <h2 className="wire-lead-headline">
                <Link href={`/articles/${lead.slug}`}>{lead.title}</Link>
              </h2>
              <p className="wire-lead-summary">{lead.summary}</p>
              <div>
                <Link href={`/articles/${lead.slug}`} className="mono wire-readlink">
                  Read the dispatch →
                </Link>
              </div>
            </article>
            {lead.thumbnail_url && (
              <Link href={`/articles/${lead.slug}`} className="wire-figure-link">
                <img className="thumb" src={lead.thumbnail_url} alt="" />
                <span className="mono wire-no-tag">No. {pad3(total)}</span>
              </Link>
            )}
          </div>
        </section>
      )}

      {lead && (
        <>
          <div className="wire-divider">
            <span className="mono wire-divider-label">Latest on the wire</span>
            <span className="wire-divider-rule" />
            <span className="mono wire-divider-count">{pad2(rows.length + 1)} dispatches</span>
          </div>

          <section className="wire-list">
            {rows.map(({ article, no }) => (
              <article key={article.id} className="wire-row">
                <div className="mono wire-row-no">{pad2(no)}</div>
                <div className="wire-row-body">
                  <Kicker article={article} />
                  <h3 className="wire-row-headline">
                    <Link href={`/articles/${article.slug}`}>{article.title}</Link>
                  </h3>
                  <p className="wire-row-summary">{article.summary}</p>
                </div>
                {article.thumbnail_url && (
                  <Link href={`/articles/${article.slug}`} className="thumb-cell">
                    <img className="thumb" src={article.thumbnail_url} alt="" />
                  </Link>
                )}
              </article>
            ))}
          </section>
        </>
      )}

      <WireFooter />
    </WireShell>
  );
}
