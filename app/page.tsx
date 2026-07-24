import Link from 'next/link';
import { getPublishedArticles } from '../lib/publicQueries';
import { formatDate } from '../lib/format';
import { TAGS } from '../lib/config';
import { Masthead, WireLine, SiteFooter, TagFilter } from './ui';
import type { Article } from '../lib/types';

// Reading searchParams makes this page render per-request; at personal
// traffic levels the spec explicitly blesses dynamic rendering (§9).
export const dynamic = 'force-dynamic';

function StoryRow({ article }: { article: Article }) {
  return (
    <li className="story-row">
      <div>
        <WireLine article={article} />
        <h3 className="story-headline">
          <Link href={`/articles/${article.slug}`}>{article.title}</Link>
        </h3>
        <p className="story-teaser">{article.summary}</p>
      </div>
      {article.thumbnail_url && (
        <Link href={`/articles/${article.slug}`}>
          <img className="print-block story-thumb" src={article.thumbnail_url} alt="" />
        </Link>
      )}
    </li>
  );
}

export default async function HomePage({ searchParams }: { searchParams: { tags?: string } }) {
  const selected = (searchParams.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => TAGS.includes(t));
  const filtering = selected.length > 0;

  const articles = await getPublishedArticles(selected);
  // Filtered views are flat lists; the lead-story hero is only for the front page.
  const lead = filtering ? null : (articles[0] ?? null);
  const rows = filtering ? articles : articles.slice(1);

  return (
    <div className="shell">
      <Masthead dateline={formatDate(new Date().toISOString())} />
      <TagFilter selected={selected} />

      {articles.length === 0 && (
        <div className="empty-state">
          <span className="meta">{filtering ? 'no matches' : 'wire idle'}</span>
          <p>
            {filtering
              ? `Nothing filed under ${selected.join(' or ')} yet.`
              : 'Nothing on the wire yet. Approved stories appear here.'}
          </p>
        </div>
      )}

      {lead && (
        <article className="lead">
          <div>
            <WireLine article={lead} />
            <h1 className="lead-headline">
              <Link href={`/articles/${lead.slug}`}>{lead.title}</Link>
            </h1>
            <p className="lead-summary">{lead.summary}</p>
          </div>
          {lead.thumbnail_url && (
            <figure className="lead-figure" style={{ margin: 0 }}>
              <Link href={`/articles/${lead.slug}`}>
                <img className="print-block lead-thumb" src={lead.thumbnail_url} alt="" />
              </Link>
            </figure>
          )}
        </article>
      )}

      {rows.length > 0 && (
        <>
          <h2 className="section-head">
            {filtering ? `Filed under ${selected.join(' or ')} (${articles.length})` : 'Latest on the wire'}
          </h2>
          <ul className="wire-list">
            {rows.map((a) => (
              <StoryRow key={a.id} article={a} />
            ))}
          </ul>
        </>
      )}

      <SiteFooter />
    </div>
  );
}
