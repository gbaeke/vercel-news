import Link from 'next/link';
import { query } from '../../../lib/db';
import { formatDateTime } from '../../../lib/format';
import { StatusChip } from '../../ui';
import type { Article } from '../../../lib/types';
import {
  approveArticle,
  requestRewrite,
  requestNewImage,
  declineArticle,
  retryArticle,
  unpublishArticle,
} from './actions';

export const dynamic = 'force-dynamic';

const STAGES = [
  { key: 'new', label: 'ingested' },
  { key: 'scraped', label: 'scraped' },
  { key: 'tagged', label: 'tagged' },
  { key: 'written', label: 'written' },
  { key: 'in_review', label: 'review' },
  { key: 'published', label: 'live' },
];

function stageIndex(status: string): number {
  const direct = STAGES.findIndex((s) => s.key === status);
  if (direct >= 0) return direct;
  if (status === 'rewrite_requested' || status === 'image_requested' || status === 'declined') return 4;
  if (status === 'approved') return 5;
  return 0;
}

function Tracker({ article }: { article: Article }) {
  const failed = article.status === 'failed';
  const current = stageIndex(failed ? article.failed_from ?? 'new' : article.status);
  const live = article.status === 'published';

  return (
    <div className="tracker" aria-label="Pipeline position">
      {STAGES.map((stage, i) => {
        let cls = 'tracker-step';
        if (failed && i === current) cls += ' tracker-step--failed';
        else if (i < current || (live && i === current)) cls += ' tracker-step--done';
        else if (i === current) cls += ' tracker-step--now';
        return (
          <span key={stage.key} style={{ display: 'contents' }}>
            {i > 0 && <span className={`tracker-link${i <= current ? ' tracker-link--done' : ''}`} />}
            <span className={cls}>{stage.label}</span>
          </span>
        );
      })}
    </div>
  );
}

export default async function ReviewDetailPage({ params }: { params: { id: string } }) {
  const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [params.id]);

  if (!article) {
    return (
      <div className="shell">
        <div className="empty-state">
          <span className="meta">not found</span>
          <p>
            No article with that id. <Link href="/review">Back to the desk</Link>.
          </p>
        </div>
      </div>
    );
  }

  const approve = approveArticle.bind(null, article.id);
  const image = requestNewImage.bind(null, article.id);
  const decline = declineArticle.bind(null, article.id);
  const retry = retryArticle.bind(null, article.id);
  const unpublish = unpublishArticle.bind(null, article.id);
  const rewrite = requestRewrite.bind(null, article.id);

  return (
    <div className="shell">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          ← The AI Wire — <em>Desk</em>
        </Link>
        <StatusChip status={article.status} />
      </header>

      <Tracker article={article} />

      {article.error && (
        <p className="error-note">
          <strong>{article.status === 'failed' ? `Failed during “${article.failed_from}”: ` : ''}</strong>
          {article.error}
        </p>
      )}

      <div className="desk-layout">
        <article>
          <h1 className="article-title" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.2rem)' }}>
            {article.title ?? article.trigger_title ?? 'Untitled'}
          </h1>
          {article.summary && <p className="standfirst">{article.summary}</p>}
          {article.thumbnail_url && (
            <figure className="article-figure">
              <img className="print-block" src={article.thumbnail_url} alt="" />
            </figure>
          )}
          {article.content_html ? (
            <div className="prose" dangerouslySetInnerHTML={{ __html: article.content_html }} />
          ) : (
            <p className="story-teaser">No draft yet — the pipeline hasn&apos;t written this one.</p>
          )}

          <details className="source-details">
            <summary>Source material</summary>
            <p className="meta" style={{ margin: '0.75rem 0' }}>
              <a href={article.trigger_url}>{article.trigger_url}</a>
            </p>
            <pre>{article.trigger_content ?? '(no scraped text)'}</pre>
          </details>
        </article>

        <aside className="desk-panel">
          <h2>Actions</h2>
          {article.status === 'in_review' && (
            <>
              <form action={approve}>
                <button type="submit" className="btn btn--primary btn--wide">
                  Approve &amp; publish
                </button>
              </form>
              <form action={rewrite} style={{ display: 'grid', gap: '0.5rem' }}>
                <textarea name="feedback" placeholder="What should change in the rewrite?" required />
                <button type="submit" className="btn btn--wide">
                  Request rewrite
                </button>
              </form>
              <form action={image}>
                <button type="submit" className="btn btn--wide">
                  New thumbnail
                </button>
              </form>
              <form action={decline}>
                <button type="submit" className="btn btn--danger btn--wide">
                  Decline
                </button>
              </form>
            </>
          )}
          {article.status === 'failed' && (
            <form action={retry}>
              <button type="submit" className="btn btn--primary btn--wide">
                Retry from “{article.failed_from}”
              </button>
            </form>
          )}
          {article.status === 'published' && (
            <form action={unpublish}>
              <button type="submit" className="btn btn--danger btn--wide">
                Unpublish
              </button>
            </form>
          )}
          {!['in_review', 'failed', 'published'].includes(article.status) && (
            <p className="meta" style={{ margin: 0 }}>
              In the pipeline — nothing to do until it reaches review.
            </p>
          )}

          <div className="desk-meta meta">
            <div>
              <span>Feed</span>
              <span>{article.source_feed}</span>
            </div>
            {article.tags?.primary && (
              <div>
                <span>Tags</span>
                <span>{[article.tags.primary, ...(article.tags.secondary ?? [])].join(', ')}</span>
              </div>
            )}
            {article.persona && (
              <div>
                <span>Persona</span>
                <span>{article.persona}</span>
              </div>
            )}
            <div>
              <span>Version</span>
              <span>{article.version}</span>
            </div>
            <div>
              <span>Updated</span>
              <span>{formatDateTime(article.updated_at)}</span>
            </div>
            {article.status === 'published' && article.slug && (
              <div>
                <span>Public</span>
                <a href={`/articles/${article.slug}`}>view live ↗</a>
              </div>
            )}
          </div>
          {article.feedback && (
            <div className="meta" style={{ marginTop: '0.5rem' }}>
              Last feedback: <em style={{ textTransform: 'none' }}>{article.feedback}</em>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
