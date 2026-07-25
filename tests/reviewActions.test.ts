import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleById,
  approveAndPublishById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
  deleteArticleById,
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

  it('unpublish returns the article to review and clears published_at', async () => {
    const id = await insertArticle('published', { published_at: new Date().toISOString() });
    await unpublishArticleById(id);
    const [row] = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('in_review');
    expect(row.published_at).toBeNull();
  });

  it('unpublish keeps the slug so re-publishing restores the same URL', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, title, slug, status, published_at)
       VALUES ('openai', 'https://example.com/keep-slug', 'Kept', 'kept-title', 'published', now())
       RETURNING id`
    );
    await unpublishArticleById(rows[0].id);
    const [row] = await query<{ slug: string | null }>(`SELECT slug FROM articles WHERE id=$1`, [rows[0].id]);
    expect(row.slug).toBe('kept-title');
  });

  it('delete removes the row for good', async () => {
    const id = await insertArticle('declined');
    await deleteArticleById(id);
    const rows = await query(`SELECT id FROM articles WHERE id=$1`, [id]);
    expect(rows.length).toBe(0);
  });

  it('delete records the trigger URL so ingest can never re-create it', async () => {
    const id = await insertArticle('published', { published_at: new Date().toISOString() });
    await deleteArticleById(id);
    const rows = await query<{ url: string }>(`SELECT url FROM deleted_urls`);
    expect(rows.map((r) => r.url)).toEqual(['https://example.com/rv']);
  });

  it('delete also removes the article thumbnail from blob storage', async () => {
    const thumb = 'https://x.public.blob.vercel-storage.com/thumbnails/42-1784897751935.png';
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/with-thumb', $1, 'published') RETURNING id`,
      [thumb]
    );
    const del = vi.fn(async () => {});
    await deleteArticleById(rows[0].id, { del });
    expect(del).toHaveBeenCalledWith(thumb);
  });

  it('delete leaves the thumbnail alone when another article still uses it', async () => {
    const shared = 'https://x.public.blob.vercel-storage.com/thumbnails/43-1784897751935.png';
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/doomed', $1, 'declined') RETURNING id`,
      [shared]
    );
    await query(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/still-live', $1, 'published')`,
      [shared]
    );
    const del = vi.fn(async () => {});
    await deleteArticleById(rows[0].id, { del });
    expect(del).not.toHaveBeenCalled();
  });

  it('delete does not try to remove a placeholder thumbnail', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/placeholder', 'data:image/svg+xml;base64,abc', 'declined') RETURNING id`
    );
    const del = vi.fn(async () => {});
    await deleteArticleById(rows[0].id, { del });
    expect(del).not.toHaveBeenCalled();
  });

  it('delete is idempotent for an id that is already gone', async () => {
    const id = await insertArticle('declined');
    await deleteArticleById(id);
    await expect(deleteArticleById(id)).resolves.toBeUndefined();
    const rows = await query(`SELECT url FROM deleted_urls`);
    expect(rows.length).toBe(1);
  });
});
