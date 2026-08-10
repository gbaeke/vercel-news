import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getPublishedArticles,
  getPublishedArticleBySlug,
  getReadyArticleAudio,
} from '../../../lib/publicQueries';
import { formatDate } from '../../../lib/format';
import { renderMarkdown } from '../../../lib/markdown';
import { WireShell, WireTopbar, WireFooter, Wordmark, pad2, pad3 } from '../../wire';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);
  if (!article) return {};
  return {
    title: article.title ?? undefined,
    description: article.seo_summary ?? undefined,
    openGraph: { images: article.thumbnail_url ? [article.thumbnail_url] : [] },
  };
}

export const revalidate = 300;

function readMinutes(contentMd: string | null): number {
  const words = (contentMd ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

// The previous link-retention implementation appended every source-page link.
// Hide that legacy appendix while retaining links the article uses inline.
function visibleArticleHtml(markdown: string | null): string {
  const withoutLegacyAppendix = (markdown ?? '')
    .replace(/\n{2}### Links from the original article\n[\s\S]*$/, '')
    .trim();
  return renderMarkdown(withoutLegacyAppendix);
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const article = await getPublishedArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  // Dispatch numbers count up from the oldest published story.
  const all = await getPublishedArticles();
  const audio = await getReadyArticleAudio(article.id);
  const idx = all.findIndex((a) => a.id === article.id);
  const dispatchNo = idx >= 0 ? all.length - idx : article.id;
  const more = all.filter((a) => a.id !== article.id).slice(0, 4);
  const filed = formatDate(article.published_at ?? article.created_at);

  return (
    <WireShell>
      <header className="wire-header wire-header--article">
        <WireTopbar back />
        <div className="wire-masthead wire-masthead--compact">
          <Wordmark size="md" />
          <span className="mono wire-dispatch-no">Dispatch No. {pad3(dispatchNo)}</span>
        </div>
      </header>

      <article className="wire-article">
        <header className="wire-article-head">
          <div className="mono kicker wire-kicker-row">
            <span className="wire-badge">
              {article.source_feed} ▸ {article.tags?.primary}
            </span>
            <span className="dim">
              · filed {filed} · {readMinutes(article.content_md)} min read
            </span>
          </div>
          <h1 className="wire-article-headline">{article.title}</h1>
          {article.summary && <p className="wire-standfirst">{article.summary}</p>}
        </header>

        {article.thumbnail_url && (
          <figure className="wire-hero">
            <img className="thumb" src={article.thumbnail_url} alt="" />
            <figcaption className="mono wire-figcaption">
              <span>Machine-drafted illustration · reviewed by a human</span>
              <span>FIG. 01</span>
            </figcaption>
          </figure>
        )}

        {audio?.blob_url && (
          <section className="wire-audio" aria-labelledby="listen-heading">
            <div>
              <p id="listen-heading" className="mono wire-audio-label">Listen to this dispatch</p>
              <p className="wire-audio-note">Narrated by an AI-generated voice.</p>
            </div>
            <audio controls preload="none" src={audio.blob_url}>
              Your browser does not support the audio player.
            </audio>
          </section>
        )}

        <div className="wire-body">
          <div className="wire-body-inner" dangerouslySetInnerHTML={{ __html: visibleArticleHtml(article.content_md) }} />
          <p className="mono wire-source">
            <a href={article.trigger_url} target="_blank" rel="noopener noreferrer" className="wire-readlink">
              Read the original at {sourceHost(article.trigger_url)} →
            </a>
          </p>
          <div className="mono wire-end">
            <span className="wire-end-rule" />
            <span>End of dispatch</span>
            <span className="wire-end-rule" />
          </div>
        </div>
      </article>

      {more.length > 0 && (
        <section className="wire-more">
          <div className="wire-divider wire-divider--more">
            <span className="mono wire-divider-label">More on the wire</span>
            <span className="wire-divider-rule" />
          </div>
          {more.map((a) => {
            const i = all.findIndex((x) => x.id === a.id);
            return (
              <Link key={a.id} href={`/articles/${a.slug}`} className="wire-more-row">
                <span className="mono wire-more-no">{pad2(all.length - i)}</span>
                <span className="wire-more-body">
                  <span className="mono wire-more-kicker">
                    {a.source_feed} ▸ {a.tags?.primary} · filed {formatDate(a.published_at ?? a.created_at)}
                  </span>
                  <span className="wire-more-title">{a.title}</span>
                </span>
              </Link>
            );
          })}
        </section>
      )}

      <WireFooter article />
    </WireShell>
  );
}
