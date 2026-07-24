import Link from 'next/link';
import { getPublishedArticles } from '../lib/publicQueries';
import { formatDate } from '../lib/format';
import { Masthead, WireLine, SiteFooter } from './ui';

export const revalidate = 300;

export default async function HomePage() {
  const articles = await getPublishedArticles();
  const [lead, ...rest] = articles;

  return (
    <div className="shell">
      <Masthead dateline={formatDate(new Date().toISOString())} />

      {!lead && (
        <div className="empty-state">
          <span className="meta">wire idle</span>
          <p>Nothing on the wire yet. Approved stories appear here.</p>
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

      {rest.length > 0 && (
        <>
          <h2 className="section-head">Latest on the wire</h2>
          <ul className="wire-list">
            {rest.map((a) => (
              <li key={a.id} className="story-row">
                <div>
                  <WireLine article={a} />
                  <h3 className="story-headline">
                    <Link href={`/articles/${a.slug}`}>{a.title}</Link>
                  </h3>
                  <p className="story-teaser">{a.summary}</p>
                </div>
                {a.thumbnail_url && (
                  <Link href={`/articles/${a.slug}`}>
                    <img className="print-block story-thumb" src={a.thumbnail_url} alt="" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <SiteFooter />
    </div>
  );
}
