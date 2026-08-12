import Link from 'next/link';
import { query } from '../../../lib/db';
import { formatDateTime } from '../../../lib/format';
import { StatusChip } from '../../ui';
import type { Article, ArticleAudio } from '../../../lib/types';
import { parseArticleId } from '../../../lib/reviewInput';
import { SubmitButton } from '../submit-button';
import { YouTubeEmbed } from '../../youtube-embed';
import { DiagramRenderer } from '../../diagram-renderer';
import { getArticleDiagram } from '../../../lib/articleDiagrams';
import { countArticleParagraphs } from '../../../lib/articleContentPlacement';
import { renderMarkdown } from '../../../lib/markdown';
import type { ArticleDiagram } from '../../../lib/types';
import {
  approveArticle,
  approveArticleDiagramAction,
  deleteArticleDiagramAction,
  generateArticleDiagramAction,
  requestRewrite,
  requestNewImage,
  refreshArticleSource,
  saveArticleDiagramAction,
  updateArticleDiagramPlacementAction,
  declineArticle,
  retryArticle,
  unpublishArticle,
  deleteArticle,
  retryArticleAudio,
} from './actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STAGES = [
  { key: 'rss_pending_review', label: 'source review' },
  { key: 'scraped', label: 'scraped' },
  { key: 'tagged', label: 'tagged' },
  { key: 'rss_final_review', label: 'draft review' },
  { key: 'published', label: 'live' },
];

function stageIndex(status: string): number {
  const direct = STAGES.findIndex((s) => s.key === status);
  if (direct >= 0) return direct;
  if (status === 'new') return 0;
  if (status === 'scraped') return 1;
  if (status === 'tagged') return 2;
  if (status === 'written' || status === 'in_review' || status === 'rewrite_requested' || status === 'image_requested' || status === 'declined') return 3;
  if (status === 'approved') return 4;
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

function NotFoundState() {
  return (
    <div className="shell">
      <div className="empty-state">
        <span className="meta">not found</span>
        <p>
          That article reference is invalid or no longer exists. <Link href="/review">Back to the desk</Link>.
        </p>
      </div>
    </div>
  );
}

function DiagramPlacementOptions({
  paragraphCount,
  currentPlacement,
}: {
  paragraphCount: number;
  currentPlacement: number;
}) {
  const afterArticleValue = Math.max(
    paragraphCount + 1,
    currentPlacement > paragraphCount ? currentPlacement : 0
  );
  return (
    <>
      <option value="0">Before article text</option>
      {Array.from({ length: paragraphCount }, (_, index) => index + 1).map((paragraph) => (
        <option key={paragraph} value={paragraph}>After paragraph {paragraph}</option>
      ))}
      <option value={afterArticleValue}>After article text</option>
    </>
  );
}

function DiagramWorkbench({
  article,
  diagram,
  paragraphCount,
}: {
  article: Article;
  diagram: ArticleDiagram | null;
  paragraphCount: number;
}) {
  const generate = generateArticleDiagramAction.bind(null, article.id);
  const save = saveArticleDiagramAction.bind(null, article.id);
  const updatePlacement = updateArticleDiagramPlacementAction.bind(null, article.id);
  const approve = approveArticleDiagramAction.bind(null, article.id);
  const remove = deleteArticleDiagramAction.bind(null, article.id);
  const stale = Boolean(diagram && diagram.article_version !== article.version);

  return (
    <details className="diagram-workbench" open={diagram ? true : undefined}>
      <summary>{diagram ? 'Explainer diagram' : 'Add explainer diagram'}</summary>
      <div className="diagram-workbench-inner">
        <div className="diagram-workbench-heading">
          <div>
            <p className="meta">Visual explainer · article version {article.version}</p>
            <h2>{diagram?.title ?? 'Create a diagram from this article'}</h2>
          </div>
          {diagram && (
            <span className={`chip ${diagram.status === 'approved' ? 'chip--live' : 'chip--review'}`}>
              {diagram.status}
            </span>
          )}
        </div>

        {stale && (
          <p className="error-note">
            This diagram was generated for article version {diagram?.article_version}. Regenerate it before approval.
          </p>
        )}

        {diagram && (
          <figure className="diagram-review-preview">
            <DiagramRenderer source={diagram.mermaid_source} look={diagram.look} label={diagram.alt_text} />
            <figcaption>{diagram.caption}</figcaption>
          </figure>
        )}

        <form action={generate} className="diagram-generator-form">
          <label className="diagram-field diagram-field--wide">
            <span>What should the diagram explain?</span>
            <textarea
              name="instructions"
              defaultValue={diagram?.instructions ?? ''}
              placeholder="For example: Show how a request moves through the model gateway, including the fallback path."
              maxLength={1500}
              required
            />
          </label>
          <label className="diagram-field">
            <span>Type</span>
            <select name="diagram_type" defaultValue={diagram?.diagram_type ?? 'auto'}>
              <option value="auto">Auto</option>
              <option value="flowchart">Flowchart</option>
              <option value="sequence">Sequence</option>
              <option value="relationship">Relationship map</option>
              <option value="architecture">Architecture</option>
            </select>
          </label>
          <label className="diagram-field">
            <span>Direction</span>
            <select name="direction" defaultValue={diagram?.direction ?? 'auto'}>
              <option value="auto">Auto</option>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
          </label>
          <label className="diagram-field">
            <span>Detail</span>
            <select name="detail" defaultValue={diagram?.detail ?? 'standard'}>
              <option value="simple">Simple</option>
              <option value="standard">Standard</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label className="diagram-field">
            <span>Look</span>
            <select name="look" defaultValue={diagram?.look ?? 'classic'}>
              <option value="classic">Wire classic</option>
              <option value="handDrawn">Hand-drawn</option>
            </select>
          </label>
          <label className="diagram-field diagram-field--wide diagram-placement-field">
            <span>Placement</span>
            <select
              name="placement_after_paragraph"
              defaultValue={diagram?.placement_after_paragraph ?? 0}
            >
              <DiagramPlacementOptions
                paragraphCount={paragraphCount}
                currentPlacement={diagram?.placement_after_paragraph ?? 0}
              />
            </select>
          </label>
          <div className="diagram-form-actions diagram-field--wide">
            <SubmitButton
              label={diagram ? 'Regenerate diagram' : 'Generate diagram'}
              pendingLabel="Generating diagram…"
              className="btn btn--primary"
            />
            <p className="meta">Generation creates a draft. Nothing appears publicly until you approve it.</p>
          </div>
        </form>

        {diagram && (
          <form action={updatePlacement} className="diagram-placement-form">
            <label className="diagram-field">
              <span>Public position</span>
              <select
                name="placement_after_paragraph"
                defaultValue={diagram.placement_after_paragraph}
              >
                <DiagramPlacementOptions
                  paragraphCount={paragraphCount}
                  currentPlacement={diagram.placement_after_paragraph}
                />
              </select>
            </label>
            <SubmitButton
              label="Update placement"
              pendingLabel="Updating placement…"
              className="btn"
            />
            <p className="meta">Changing placement returns the diagram to draft for layout review.</p>
          </form>
        )}

        {diagram && (
          <details className="diagram-source-editor">
            <summary>Edit diagram source and copy</summary>
            <form action={save} className="diagram-edit-form">
              <input type="hidden" name="instructions" value={diagram.instructions} />
              <input type="hidden" name="diagram_type" value={diagram.diagram_type} />
              <input type="hidden" name="direction" value={diagram.direction} />
              <input type="hidden" name="detail" value={diagram.detail} />
              <input type="hidden" name="look" value={diagram.look} />
              <input
                type="hidden"
                name="placement_after_paragraph"
                value={diagram.placement_after_paragraph}
              />
              <label className="diagram-field">
                <span>Title</span>
                <input name="title" defaultValue={diagram.title} maxLength={120} required />
              </label>
              <label className="diagram-field">
                <span>Caption</span>
                <textarea name="caption" defaultValue={diagram.caption} maxLength={300} required />
              </label>
              <label className="diagram-field">
                <span>Alt text</span>
                <textarea name="alt_text" defaultValue={diagram.alt_text} maxLength={500} required />
              </label>
              <label className="diagram-field">
                <span>Mermaid source</span>
                <textarea
                  className="diagram-source-input"
                  name="mermaid_source"
                  defaultValue={diagram.mermaid_source}
                  maxLength={12000}
                  spellCheck={false}
                  required
                />
              </label>
              <SubmitButton label="Save draft changes" pendingLabel="Saving diagram…" className="btn" />
            </form>
          </details>
        )}

        {diagram && (
          <div className="diagram-approval-row">
            <form action={approve}>
              <SubmitButton
                label={diagram.status === 'approved' ? 'Re-approve diagram' : 'Approve diagram'}
                pendingLabel="Approving diagram…"
                className="btn btn--primary"
                disabled={stale}
              />
            </form>
            <form action={remove}>
              <SubmitButton label="Remove diagram" pendingLabel="Removing diagram…" className="btn btn--danger" />
            </form>
          </div>
        )}
      </div>
    </details>
  );
}

export default async function ReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const [{ id: rawId }, feedback] = await Promise.all([params, searchParams]);
  const id = parseArticleId(rawId);
  if (id === null) return <NotFoundState />;

  const [[article], [audio], diagram] = await Promise.all([
    query<Article>(`SELECT * FROM articles WHERE id = $1`, [id]),
    query<ArticleAudio>(`SELECT * FROM article_audio WHERE article_id = $1`, [id]),
    getArticleDiagram(id),
  ]);

  if (!article) {
    return <NotFoundState />;
  }

  const paragraphCount = countArticleParagraphs(
    article.content_html ?? renderMarkdown(article.content_md ?? '')
  );

  const approve = approveArticle.bind(null, article.id);
  const image = requestNewImage.bind(null, article.id);
  const decline = declineArticle.bind(null, article.id);
  const retry = retryArticle.bind(null, article.id);
  const unpublish = unpublishArticle.bind(null, article.id);
  const rewrite = requestRewrite.bind(null, article.id);
  const refreshSource = refreshArticleSource.bind(null, article.id);
  const remove = deleteArticle.bind(null, article.id);
  const retryAudio = retryArticleAudio.bind(null, article.id);

  return (
    <div className="shell">
      <header className="desk-bar">
        <Link href="/review" className="desk-mark">
          ← The AI Wire — <em>Desk</em>
        </Link>
        <div className="desk-actions desk-actions--detail">
          <Link href="/" className="btn">
            View the wire ↗
          </Link>
          <StatusChip status={article.status} />
        </div>
      </header>

      <Tracker article={article} />

      {feedback.error && <p className="error-note">{feedback.error}</p>}
      {feedback.notice && <p className="notice-note">{feedback.notice}</p>}

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
          {article.status === 'rss_pending_review' && (
            <section className="source-details" style={{ margin: '0 0 1.25rem' }}>
              <strong>RSS source preview</strong>
              <p className="standfirst" style={{ margin: '0.6rem 0' }}>
                {article.trigger_content ?? 'This feed item has no description.'}
              </p>
              <a href={article.trigger_url}>Open source article ↗</a>
            </section>
          )}
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
          {article.youtube_video_id && (
            <YouTubeEmbed
              videoId={article.youtube_video_id}
              title={`Watch ${article.trigger_title ?? article.title ?? 'the submitted YouTube video'}`}
              variant="review"
            />
          )}

          <details className="source-details">
            <summary>{article.youtube_video_id ? 'Transcript analysis' : 'Source material'}</summary>
            <p className="meta" style={{ margin: '0.75rem 0' }}>
              <a href={article.trigger_url}>{article.trigger_url}</a>
            </p>
            <pre>{article.trigger_content ?? '(no scraped text)'}</pre>
          </details>
          {article.source_transcript && (
            <details className="source-details">
              <summary>Full video transcript</summary>
              <p className="meta" style={{ margin: '0.75rem 0' }}>
                Language: {article.source_transcript_lang ?? 'unknown'} · Provider: {article.source_provider ?? 'unknown'}
              </p>
              <pre>{article.source_transcript}</pre>
            </details>
          )}
          {['in_review', 'rss_final_review', 'published'].includes(article.status) && (
            <DiagramWorkbench
              article={article}
              diagram={diagram}
              paragraphCount={paragraphCount}
            />
          )}
        </article>

        <aside className="desk-panel">
          <h2>Actions</h2>
          {article.status === 'rss_pending_review' && (
            <>
              <form action={approve}>
                <SubmitButton
                  label="Approve source & draft"
                  pendingLabel="Approving source…"
                  className="btn btn--primary btn--wide"
                />
              </form>
              <form action={decline}>
                <SubmitButton
                  label="Decline"
                  pendingLabel="Declining…"
                  className="btn btn--danger btn--wide"
                />
              </form>
            </>
          )}
          {article.status === 'rss_final_review' && (
            <>
              <form action={approve}>
                <SubmitButton
                  label="Final approve & publish"
                  pendingLabel="Generating thumbnail & publishing…"
                  className="btn btn--primary btn--wide"
                />
              </form>
              <form action={decline}>
                <SubmitButton
                  label="Decline"
                  pendingLabel="Declining…"
                  className="btn btn--danger btn--wide"
                />
              </form>
            </>
          )}
          {article.status === 'in_review' && (
            <>
              <form action={approve}>
                <SubmitButton
                  label="Approve & publish"
                  pendingLabel="Publishing…"
                  className="btn btn--primary btn--wide"
                />
              </form>
              <form action={rewrite} style={{ display: 'grid', gap: '0.5rem' }}>
                <textarea name="feedback" placeholder="What should change in the rewrite?" required />
                <SubmitButton
                  label="Request rewrite"
                  pendingLabel="Requesting rewrite…"
                  className="btn btn--wide"
                />
              </form>
              <form action={image}>
                <SubmitButton
                  label="New thumbnail"
                  pendingLabel="Requesting thumbnail…"
                  className="btn btn--wide"
                />
              </form>
              <form action={refreshSource}>
                <SubmitButton
                  label="Re-fetch source & redraft"
                  pendingLabel="Queuing source refresh…"
                  className="btn btn--wide"
                />
              </form>
              <form action={decline}>
                <SubmitButton
                  label="Decline"
                  pendingLabel="Declining…"
                  className="btn btn--danger btn--wide"
                />
              </form>
            </>
          )}
          {article.status === 'failed' && (
            <form action={retry}>
              <SubmitButton
                label={`Retry from “${article.failed_from}”`}
                pendingLabel={`Retrying from “${article.failed_from}”…`}
                className="btn btn--primary btn--wide"
              />
            </form>
          )}
          {article.status === 'published' && (
            <>
              <section className="desk-audio">
                <h2>Audio edition</h2>
                {!audio && (
                  <p className="meta">
                    Not queued. This can happen if audio enqueueing was unavailable when the article went live.
                  </p>
                )}
                {audio?.status === 'ready' && audio.blob_url && (
                  <>
                    <audio controls preload="none" src={audio.blob_url}>
                      Your browser does not support the audio player.
                    </audio>
                    <p className="meta">
                      Ready · {audio.voice} · {audio.model}
                    </p>
                  </>
                )}
                {audio?.status === 'pending' && (
                  <p className="meta">
                    Queued
                    {audio.next_attempt_at ? ` · next attempt ${formatDateTime(audio.next_attempt_at)}` : ''}
                    {audio.last_error ? ` · ${audio.last_error}` : ''}
                  </p>
                )}
                {audio?.status === 'processing' && (
                  <p className="meta">Generating · attempt {audio.attempt_count} of 3</p>
                )}
                {audio?.status === 'failed' && (
                  <p className="error-note" style={{ margin: 0 }}>
                    Audio failed after {audio.attempt_count} attempt{audio.attempt_count === 1 ? '' : 's'}.
                    {audio.last_error ? ` ${audio.last_error}` : ''}
                  </p>
                )}
                {(!audio || audio.status === 'failed' || audio.status === 'ready') && (
                  <form action={retryAudio}>
                    <SubmitButton
                      label={audio?.status === 'ready' ? 'Regenerate audio' : 'Queue audio'}
                      pendingLabel="Queueing audio…"
                      className="btn btn--wide"
                    />
                  </form>
                )}
                <p className="meta">
                  Public feed: <a href="/podcast.xml">/podcast.xml ↗</a>
                </p>
              </section>
              <form action={unpublish}>
                <SubmitButton
                  label="Unpublish → back to review"
                  pendingLabel="Unpublishing…"
                  className="btn btn--wide"
                />
                <p className="meta" style={{ margin: '0.4rem 0 0' }}>
                  Pulls it off the site and onto the desk. The slug is kept, so
                  re-approving restores the same URL.
                </p>
              </form>
            </>
          )}
          {!['rss_pending_review', 'rss_final_review', 'in_review', 'failed', 'published'].includes(article.status) && (
            <p className="meta" style={{ margin: 0 }}>
              {article.status === 'declined'
                ? 'Declined — it will not run again. Delete it below to clear it out.'
                : 'In the pipeline — nothing to do until it reaches review.'}
            </p>
          )}

          <details className="source-details" style={{ margin: '0.5rem 0 0' }}>
            <summary>Danger zone</summary>
            <p className="meta" style={{ margin: '0.6rem 0', textTransform: 'none' }}>
              Deletes the article for good and remembers the source URL, so the
              next scheduled run will not ingest it again. Cannot be undone.
            </p>
            <form action={remove}>
              <SubmitButton
                label="Delete permanently"
                pendingLabel="Deleting permanently…"
                className="btn btn--danger btn--wide"
              />
            </form>
          </details>

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
              <span>Source</span>
              <span>
                {article.source_extraction_method}
                {article.source_content_length ? ` · ${article.source_content_length.toLocaleString()} chars` : ''}
                {article.source_attempt_count > 0 ? ` · ${article.source_attempt_count} attempt${article.source_attempt_count === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            {article.source_fallback_reason && (
              <div>
                <span>Source note</span>
                <span style={{ textTransform: 'none' }}>{article.source_fallback_reason}</span>
              </div>
            )}
            {article.source_external_job_id && (
              <div>
                <span>Transcript job</span>
                <span>processing · {article.source_external_job_id}</span>
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
