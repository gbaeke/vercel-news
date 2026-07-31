import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleById,
  approveAndPublishById,
  approveRssFirstReviewById,
  approveRssFinalReviewAndPublishById,
  requestRewriteById,
  requestNewImageById,
  refreshArticleSourceById,
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
  it('first RSS approval only queues the article pipeline', async () => {
    const id = await insertArticle('rss_pending_review');
    await query(`UPDATE articles SET rss_approval_required = true WHERE id = $1`, [id]);

    const result = await approveRssFirstReviewById(id);
    const [row] = await query<{ status: string; thumbnail_url: string | null }>(
      `SELECT status, thumbnail_url FROM articles WHERE id = $1`, [id]
    );
    expect(result).toEqual({ ok: true });
    expect(row).toEqual({ status: 'new', thumbnail_url: null });
  });

  it('final RSS approval generates the thumbnail before publishing', async () => {
    const id = await insertArticle('rss_final_review');
    await query(`UPDATE articles SET rss_approval_required = true, title = 'RSS Draft', summary = 'Summary' WHERE id = $1`, [id]);
    const order: string[] = [];

    const result = await approveRssFinalReviewAndPublishById(id, {
      thumbnail: async () => { order.push('thumbnail'); return 'thumbnail'; },
      publish: async () => { order.push('publish'); return 'published'; },
    });

    expect(result).toEqual({ ok: true, outcome: 'published' });
    expect(order).toEqual(['thumbnail', 'publish']);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id = $1`, [id]);
    expect(row.status).toBe('approved');
  });
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
    const result = await approveAndPublishById(rows[0].id);
    const [row] = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM articles WHERE id=$1`, [rows[0].id]
    );
    expect(row.status).toBe('published');
    expect(row.published_at).not.toBeNull();
    expect(result).toEqual({ ok: true, outcome: 'published' });
  });

  it('reports a publish failure while leaving the approved article queued for retry', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, title, summary, status)
       VALUES ('openai', 'https://example.com/queued', 'Queued Title', 'Sum', 'in_review')
       RETURNING id`
    );
    const result = await approveAndPublishById(rows[0].id, {
      publish: async () => {
        throw new Error('gateway unavailable');
      },
    });
    const [row] = await query<{ status: string }>(
      `SELECT status FROM articles WHERE id = $1`,
      [rows[0].id]
    );
    expect(result).toEqual({ ok: true, outcome: 'queued' });
    expect(row.status).toBe('approved');
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

  it('refreshArticleSource clears the draft and queues a fresh scrape from review', async () => {
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, title, content_md, content_html, summary, tags, status)
       VALUES ('openai', 'https://example.com/refresh', 'Old', 'Old body', '<p>Old body</p>', 'Old summary', $1, 'in_review')
       RETURNING id`,
      [JSON.stringify({ primary: 'models', secondary: [] })]
    );
    await expect(refreshArticleSourceById(rows[0].id)).resolves.toEqual({ ok: true });
    const [row] = await query<{ status: string; title: string | null; content_md: string | null; tags: unknown }>(
      `SELECT status, title, content_md, tags FROM articles WHERE id = $1`, [rows[0].id]
    );
    expect(row).toMatchObject({ status: 'new', title: null, content_md: null, tags: null });
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

  it('refuses stale transitions without changing the current status', async () => {
    const id = await insertArticle('published', { published_at: new Date().toISOString() });
    const result = await approveArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(result).toEqual({ ok: false, reason: 'invalid_state', status: 'published' });
    expect(row.status).toBe('published');
  });

  it('refuses retry when failed_from is missing instead of assigning a null status', async () => {
    const id = await insertArticle('failed');
    const result = await retryArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(result).toEqual({ ok: false, reason: 'invalid_state', status: 'failed' });
    expect(row.status).toBe('failed');
  });

  it('reports a missing article', async () => {
    await expect(requestNewImageById(999_999)).resolves.toEqual({ ok: false, reason: 'not_found' });
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

  it('delete also removes a ready narrated MP3 from blob storage', async () => {
    const audioUrl = 'https://x.public.blob.vercel-storage.com/audio/42/v1-abc.mp3';
    const rows = await query<{ id: number }>(
      `INSERT INTO articles (source_feed, trigger_url, title, content_md, slug, status, published_at)
       VALUES ('openai', 'https://example.com/with-audio', 'Audio', 'Body', 'audio', 'published', now())
       RETURNING id`
    );
    await query(
      `INSERT INTO article_audio (
         article_id, article_version, source_hash, status, model, voice,
         blob_url, byte_length, media_type, generated_at
       ) VALUES ($1, 1, 'hash', 'ready', 'openai/tts-1', 'alloy', $2, 123, 'audio/mpeg', now())`,
      [rows[0].id, audioUrl]
    );
    const del = vi.fn(async () => {});
    await deleteArticleById(rows[0].id, { del });
    expect(del).toHaveBeenCalledWith(audioUrl);
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
    await expect(deleteArticleById(id)).resolves.toEqual({ ok: true });
    await expect(deleteArticleById(id)).resolves.toEqual({ ok: false, reason: 'not_found' });
    const rows = await query(`SELECT url FROM deleted_urls`);
    expect(rows.length).toBe(1);
  });
});
