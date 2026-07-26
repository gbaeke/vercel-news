import Link from 'next/link';
import { getPublishedArticles } from '../lib/publicQueries';
import { getTags } from '../lib/tags';
import { formatDate } from '../lib/format';
import { SITE_TAGLINE } from '../lib/config';
import { WireShell, WireTopbar, WireFooter, Wordmark, pad2, pad3 } from './wire';
import { normalizeSearchQuery, searchPublishedArticles } from '../lib/search';
import { SearchForm } from './search-form';
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

const PAGE_SIZE = 10;

export default async function HomePage({
  searchParams,
}: {
  searchParams: { tag?: string; page?: string; q?: string };
}) {
  const allTags = await getTags();
  const active = allTags.includes(searchParams.tag ?? '') ? searchParams.tag! : 'all';
  const searchQuery = normalizeSearchQuery(searchParams.q);
  let searchFailed = false;
  let articles: Article[];

  if (searchQuery) {
    try {
      articles = await searchPublishedArticles(
        searchQuery,
        active === 'all' ? [] : [active]
      );
    } catch (error) {
      console.error('[search] semantic search failed; showing the latest articles', error);
      searchFailed = true;
      articles = await getPublishedArticles();
    }
  } else {
    articles = await getPublishedArticles();
  }

  const searching = Boolean(searchQuery) && !searchFailed;
  const total = articles.length;
  const allRows = searching
    ? articles.map((article, i) => ({ article, no: i + 1 }))
    : articles
        .slice(1)
        .map((article, i) => ({ article, no: total - 1 - i }))
        .filter(({ article }) => active === 'all' || matchesTag(article, active));

  const pages = searching ? 1 : Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(searchParams.page) || 1));
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  // The lead-story hero only runs on the front page.
  const lead = !searching && page === 1 ? (articles[0] ?? null) : null;

  const filterHref = (tag: string) => {
    const qs = new URLSearchParams();
    if (tag !== 'all') qs.set('tag', tag);
    if (searchQuery) qs.set('q', searchQuery);
    const value = qs.toString();
    return value ? `/?${value}` : '/';
  };

  const pageHref = (p: number) => {
    const qs = new URLSearchParams();
    if (active !== 'all') qs.set('tag', active);
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `/?${s}` : '/';
  };

  const clearSearchHref = active === 'all'
    ? '/'
    : `/?${new URLSearchParams({ tag: active })}`;

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
          <Link href={filterHref('all')} className={`pill${active === 'all' ? ' on' : ''}`}>
            all
          </Link>
          {allTags.map((tag) => (
            <Link key={tag} href={filterHref(tag)} className={`pill${active === tag ? ' on' : ''}`}>
              {tag}
            </Link>
          ))}
        </nav>
        <SearchForm query={searchQuery} activeTag={active} clearHref={clearSearchHref} />
      </header>

      {searchFailed && (
        <p className="mono wire-search-note">
          Search is temporarily unavailable. The latest dispatches are shown below.
        </p>
      )}

      {total === 0 && !searching && (
        <p className="mono wire-empty">Wire idle — nothing on the wire yet. Approved stories appear here.</p>
      )}

      {total === 0 && searching && (
        <p className="mono wire-empty">
          No dispatches matched “{searchQuery}”.
        </p>
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

      {total > 0 && (
        <>
          <div className="wire-divider">
            <span className="mono wire-divider-label">
              {searching
                ? 'Search results'
                : page === 1
                  ? 'Latest on the wire'
                  : 'From the archive'}
            </span>
            <span className="wire-divider-rule" />
            <span className="mono wire-divider-count">
              {searching
                ? `${pad2(allRows.length)} matches`
                : `${pad2(allRows.length + 1)} dispatches${pages > 1 ? ` · page ${pad2(page)} / ${pad2(pages)}` : ''}`}
            </span>
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

          {!searching && pages > 1 && (
            <nav className="mono wire-pager" aria-label="Pages">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="wire-readlink">
                  ← Newer dispatches
                </Link>
              ) : (
                <span className="dim">← Newer dispatches</span>
              )}
              {page < pages ? (
                <Link href={pageHref(page + 1)} className="wire-readlink">
                  Older dispatches →
                </Link>
              ) : (
                <span className="dim">Older dispatches →</span>
              )}
            </nav>
          )}
        </>
      )}

      <WireFooter />
    </WireShell>
  );
}
