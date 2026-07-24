import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';
import { thumbnailHandler } from '../../lib/handlers/thumbnail';

async function insertArticle(status = 'written') {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, title, summary, status)
     VALUES ('openai', 'https://example.com/t', 'A Title', 'A summary', $1) RETURNING *`,
    [status]
  );
  return rows[0];
}

describe('thumbnailHandler', () => {
  it('uploads a generated image to Blob and moves to in_review', async () => {
    const article = await insertArticle();
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('fake-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/generated.png',
    });
    expect(to).toBe('in_review');

    const [row] = await query<{ thumbnail_url: string; status: string }>(
      `SELECT thumbnail_url, status FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.thumbnail_url).toBe('https://blob.example.com/generated.png');
    expect(row.status).toBe('in_review');
  });

  it('falls back to a placeholder and still moves to in_review when generation fails', async () => {
    const article = await insertArticle();
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => { throw new Error('image API down'); },
      uploadBlob: vi.fn(),
    });
    expect(to).toBe('in_review');

    const [row] = await query<{ thumbnail_url: string; status: string }>(
      `SELECT thumbnail_url, status FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.thumbnail_url).toContain('data:image/svg+xml');
    expect(row.status).toBe('in_review');
  });

  it('regenerates when starting from image_requested', async () => {
    const article = await insertArticle('image_requested');
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('new-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/new.png',
    });
    expect(to).toBe('in_review');
  });
});
