import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleById,
  approveAndPublishById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
} from '../lib/reviewActions';

async function insertArticle(status: string, extra: Record<string, any> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, status, failed_from, published_at)
     VALUES ('openai', 'https://example.com/rv', $1, $2, $3) RETURNING id`,
    [status, extra.failed_from ?? null, extra.published_at ?? null]
  );
  return rows[0].id;
}

describe('review actions', () => {
  it('approve sets status=approved', async () => {
    const id = await insertArticle('in_review');
    await approveArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('approved');
  });

  it('approveAndPublish publishes immediately (FAKE_LLM)', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, title, summary, slug, status)
       VALUES ('openai', 'https://example.com/instant', 'Instant Title', 'Sum', 'instant-title', 'in_review')
       RETURNING id`
    );
    await approveAndPublishById(rows[0].id);
    const [row] = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM articles WHERE id=$1`, [rows[0].id]
    );
    expect(row.status).toBe('published');
    expect(row.published_at).not.toBeNull();
  });

  it('requestRewrite stores feedback and sets status=rewrite_requested', async () => {
    const id = await insertArticle('in_review');
    await requestRewriteById(id, 'make it punchier');
    const [row] = await query<{ status: string; feedback: string }>(
      `SELECT status, feedback FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('rewrite_requested');
    expect(row.feedback).toBe('make it punchier');
  });

  it('requestNewImage sets status=image_requested', async () => {
    const id = await insertArticle('in_review');
    await requestNewImageById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('image_requested');
  });

  it('decline sets status=declined', async () => {
    const id = await insertArticle('in_review');
    await declineArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('declined');
  });

  it('retry restores failed_from and clears error', async () => {
    const id = await insertArticle('failed', { failed_from: 'tagged' });
    await retryArticleById(id);
    const [row] = await query<{ status: string; error: string | null }>(
      `SELECT status, error FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('tagged');
    expect(row.error).toBeNull();
  });

  it('unpublish sets status=declined and clears published_at', async () => {
    const id = await insertArticle('published', { published_at: new Date().toISOString() });
    await unpublishArticleById(id);
    const [row] = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('declined');
    expect(row.published_at).toBeNull();
  });
});
