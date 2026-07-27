import { query } from './db';
import {
  deleteAudioIfOrphaned,
  deleteThumbnailIfOrphaned,
  type BlobCleanupDeps,
} from './blobCleanup';
import { publishHandler } from './handlers/publish';
import type { Article } from './types';

export type ReviewMutationResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_state'; status: string };

export type ApproveAndPublishResult =
  | { ok: true; outcome: 'published' | 'queued' }
  | Exclude<ReviewMutationResult, { ok: true }>;

export interface PublishDeps {
  publish?: (article: Article) => Promise<string>;
}

async function failedMutationResult(id: number): Promise<ReviewMutationResult> {
  const [article] = await query<{ status: string }>(`SELECT status FROM articles WHERE id = $1`, [id]);
  return article
    ? { ok: false, reason: 'invalid_state', status: article.status }
    : { ok: false, reason: 'not_found' };
}

export async function approveArticleById(id: number): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = 'approved', updated_at = now()
     WHERE id = $1 AND status = 'in_review'
     RETURNING id`,
    [id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

// Approve on the desk publishes immediately. If the publish step fails, the
// row stays at 'approved' and the next tick retries it — no stuck state.
export async function approveAndPublishById(
  id: number,
  deps: PublishDeps = {}
): Promise<ApproveAndPublishResult> {
  const approved = await approveArticleById(id);
  if (!approved.ok) return approved;

  const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [id]);
  if (!article) return { ok: false, reason: 'not_found' };

  try {
    await (deps.publish ?? publishHandler)(article);
    return { ok: true, outcome: 'published' };
  } catch (err) {
    console.error(`[review] immediate publish failed for article ${id}, left at approved`, err);
    return { ok: true, outcome: 'queued' };
  }
}

export async function requestRewriteById(id: number, feedback: string): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = 'rewrite_requested', feedback = $1, updated_at = now()
     WHERE id = $2 AND status = 'in_review'
     RETURNING id`,
    [feedback, id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

export async function requestNewImageById(id: number): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = 'image_requested', updated_at = now()
     WHERE id = $1 AND status = 'in_review'
     RETURNING id`,
    [id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

export async function declineArticleById(id: number): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = 'declined', updated_at = now()
     WHERE id = $1 AND status = 'in_review'
     RETURNING id`,
    [id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

export async function retryArticleById(id: number): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = failed_from, error = NULL, failed_from = NULL, updated_at = now()
     WHERE id = $1 AND status = 'failed' AND failed_from IS NOT NULL
     RETURNING id`,
    [id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

// Unpublish pulls the story off the site and back onto the desk, so it can be
// rewritten, re-imaged, re-approved or declined. The slug is kept on purpose —
// publishHandler reuses it, so re-approving restores the same public URL.
export async function unpublishArticleById(id: number): Promise<ReviewMutationResult> {
  const rows = await query<{ id: number }>(
    `UPDATE articles
     SET status = 'in_review', published_at = NULL, updated_at = now()
     WHERE id = $1 AND status = 'published'
     RETURNING id`,
    [id]
  );
  return rows.length > 0 ? { ok: true } : failedMutationResult(id);
}

// Permanent: the row goes, and the trigger URL is tombstoned in one statement
// so ingest can never bring the story back on a later tick. The thumbnail is
// swept afterwards — only once the row is gone can it be judged an orphan.
export async function deleteArticleById(
  id: number,
  deps: BlobCleanupDeps = {}
): Promise<ReviewMutationResult> {
  const rows = await query<{ thumbnail_url: string | null; audio_url: string | null }>(
    `WITH doomed AS (
       SELECT articles.trigger_url, articles.thumbnail_url, article_audio.blob_url AS audio_url
       FROM articles
       LEFT JOIN article_audio ON article_audio.article_id = articles.id
       WHERE articles.id = $1
     ), gone AS (
       DELETE FROM articles
       WHERE id = $1
       RETURNING trigger_url
     ), tombstone AS (
       INSERT INTO deleted_urls (url)
       SELECT trigger_url FROM gone
       ON CONFLICT (url) DO NOTHING
     )
     SELECT doomed.thumbnail_url, doomed.audio_url
     FROM doomed
     WHERE EXISTS (SELECT 1 FROM gone)`,
    [id]
  );
  if (rows.length === 0) return { ok: false, reason: 'not_found' };

  await deleteThumbnailIfOrphaned(rows[0]?.thumbnail_url, deps);
  await deleteAudioIfOrphaned(rows[0]?.audio_url, deps);
  return { ok: true };
}
