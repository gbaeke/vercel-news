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

export async function unpublishArticleById(id: number): Promise<void> {
  await query(
    `UPDATE articles SET status = 'declined', published_at = NULL, updated_at = now() WHERE id = $1`,
    [id]
  );
}
