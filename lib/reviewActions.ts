import { query } from './db';
import { publishHandler } from './handlers/publish';
import type { Article } from './types';

export async function approveArticleById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'approved', updated_at = now() WHERE id = $1`, [id]);
}

// Approve on the desk publishes immediately. If the publish step fails, the
// row stays at 'approved' and the next tick retries it — no stuck state.
export async function approveAndPublishById(id: number): Promise<void> {
  await approveArticleById(id);
  const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [id]);
  if (!article) return;
  try {
    await publishHandler(article);
  } catch (err) {
    console.log(`[review] immediate publish failed for article ${id}, left at approved: ${(err as Error).message}`);
  }
}

export async function requestRewriteById(id: number, feedback: string): Promise<void> {
  await query(
    `UPDATE articles SET status = 'rewrite_requested', feedback = $1, updated_at = now() WHERE id = $2`,
    [feedback, id]
  );
}

export async function requestNewImageById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'image_requested', updated_at = now() WHERE id = $1`, [id]);
}

export async function declineArticleById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'declined', updated_at = now() WHERE id = $1`, [id]);
}

export async function retryArticleById(id: number): Promise<void> {
  await query(
    `UPDATE articles SET status = failed_from, error = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}

// Unpublish pulls the story off the site and back onto the desk, so it can be
// rewritten, re-imaged, re-approved or declined. The slug is kept on purpose —
// publishHandler reuses it, so re-approving restores the same public URL.
export async function unpublishArticleById(id: number): Promise<void> {
  await query(
    `UPDATE articles SET status = 'in_review', published_at = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}

// Permanent: the row goes, and the trigger URL is tombstoned in one statement
// so ingest can never bring the story back on a later tick.
export async function deleteArticleById(id: number): Promise<void> {
  await query(
    `WITH gone AS (
       DELETE FROM articles WHERE id = $1 RETURNING trigger_url
     )
     INSERT INTO deleted_urls (url)
     SELECT trigger_url FROM gone
     ON CONFLICT (url) DO NOTHING`,
    [id]
  );
}
