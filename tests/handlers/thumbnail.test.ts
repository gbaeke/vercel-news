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

  it('deletes the thumbnail it replaced, but only after the new one is stored', async () => {
    const old = 'https://x.public.blob.vercel-storage.com/thumbnails/9-1784897751935.png';
    const rows = await query<any>(
      `INSERT INTO articles (source_feed, trigger_url, title, summary, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/regen', 'T', 'S', $1, 'image_requested') RETURNING *`,
      [old]
    );
    const del = vi.fn(async () => {});
    await thumbnailHandler(rows[0], {
      generateImage: async () => Buffer.from('new-image-bytes'),
      uploadBlob: async () => 'https://x.public.blob.vercel-storage.com/thumbnails/9-1784999999999.png',
      del,
    });

    const [row] = await query<{ thumbnail_url: string }>(`SELECT thumbnail_url FROM articles WHERE id=$1`, [rows[0].id]);
    // New image is live in the row, and only then is the old one dropped.
    expect(row.thumbnail_url).toBe('https://x.public.blob.vercel-storage.com/thumbnails/9-1784999999999.png');
    expect(del).toHaveBeenCalledWith(old);
  });

  it('keeps the old thumbnail when the upload failed and the placeholder took over', async () => {
    const old = 'https://x.public.blob.vercel-storage.com/thumbnails/10-1784897751935.png';
    const rows = await query<any>(
      `INSERT INTO articles (source_feed, trigger_url, title, summary, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/regen-fail', 'T', 'S', $1, 'image_requested') RETURNING *`,
      [old]
    );
    const del = vi.fn(async () => {});
    await thumbnailHandler(rows[0], {
      generateImage: async () => { throw new Error('image API down'); },
      uploadBlob: vi.fn(),
      del,
    });
    // Falling back to a placeholder is already a downgrade; do not also destroy
    // the image the reviewer had.
    expect(del).not.toHaveBeenCalled();
  });

  it('keeps the old thumbnail when another article still points at it', async () => {
    const shared = 'https://x.public.blob.vercel-storage.com/thumbnails/11-1784897751935.png';
    const rows = await query<any>(
      `INSERT INTO articles (source_feed, trigger_url, title, summary, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/regen-shared', 'T', 'S', $1, 'image_requested') RETURNING *`,
      [shared]
    );
    await query(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/other-live', $1, 'published')`,
      [shared]
    );
    const del = vi.fn(async () => {});
    await thumbnailHandler(rows[0], {
      generateImage: async () => Buffer.from('bytes'),
      uploadBlob: async () => 'https://x.public.blob.vercel-storage.com/thumbnails/11-1785000000000.png',
      del,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('notifies the reviewer when a written article reaches in_review', async () => {
    const article = await insertArticle('written');
    const notify = vi.fn(async () => true);
    await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('fake-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/generated.png',
      notify,
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: article.id }),
      'https://blob.example.com/generated.png'
    );
  });

  it('does not notify again on image regeneration', async () => {
    const article = await insertArticle('image_requested');
    const notify = vi.fn(async () => true);
    await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('new-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/new.png',
      notify,
    });
    expect(notify).not.toHaveBeenCalled();
  });
});
