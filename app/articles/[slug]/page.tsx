import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublishedArticleBySlug } from '../../../lib/publicQueries';
import { Masthead, WireLine, SiteFooter } from '../../ui';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const article = await getPublishedArticleBySlug(params.slug);
  if (!article) return {};
  return {
    title: article.title ?? undefined,
    description: article.seo_summary ?? undefined,
    openGraph: { images: article.thumbnail_url ? [article.thumbnail_url] : [] },
  };
}

export const revalidate = 300;

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await getPublishedArticleBySlug(params.slug);

  if (!article) {
    return (
      <div className="shell">
        <Masthead />
        <div className="empty-state">
          <span className="meta">not on the wire</span>
          <p>
            This story doesn&apos;t exist or was taken down. <Link href="/">Back to the wire</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Masthead />
      <article>
        <header className="article-head">
          <WireLine article={article} />
          <h1 className="article-title">{article.title}</h1>
          {article.summary && <p className="standfirst">{article.summary}</p>}
        </header>
        {article.thumbnail_url && (
          <figure className="article-figure">
            <img className="print-block" src={article.thumbnail_url} alt="" />
          </figure>
        )}
        <div className="prose" dangerouslySetInnerHTML={{ __html: article.content_html ?? '' }} />
      </article>
      <Link href="/" className="backlink">
        ← Back to the wire
      </Link>
      <SiteFooter />
    </div>
  );
}
