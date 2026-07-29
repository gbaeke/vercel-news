import { describe, expect, it, vi } from 'vitest';
import { query } from '../lib/db';
import { cleanupDeclinedArticles } from '../lib/declinedCleanup';

describe('declined article cleanup', () => {
  it('deletes declined articles, their orphaned thumbnails, and tombstones their URLs', async () => {
    const thumbnail = 'https://x.public.blob.vercel-storage.com/thumbnails/declined.png';
    await query(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/declined', $1, 'declined'),
              ('openai', 'https://example.com/keep', NULL, 'in_review')`,
      [thumbnail]
    );
    const del = vi.fn(async () => {});

    await expect(cleanupDeclinedArticles({ del })).resolves.toEqual({ deleted: 1 });
    await expect(query(`SELECT id FROM articles WHERE status = 'declined'`)).resolves.toEqual([]);
    await expect(query(`SELECT url FROM deleted_urls`)).resolves.toEqual([
      { url: 'https://example.com/declined' },
    ]);
    expect(del).toHaveBeenCalledWith(thumbnail);
    await expect(query(`SELECT id FROM articles WHERE trigger_url = 'https://example.com/keep'`)).resolves.toHaveLength(1);
  });

  it('keeps a thumbnail still referenced by another article', async () => {
    const thumbnail = 'https://x.public.blob.vercel-storage.com/thumbnails/shared.png';
    await query(
      `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
       VALUES ('openai', 'https://example.com/declined', $1, 'declined'),
              ('openai', 'https://example.com/published', $1, 'published')`,
      [thumbnail]
    );
    const del = vi.fn(async () => {});

    await expect(cleanupDeclinedArticles({ del })).resolves.toEqual({ deleted: 1 });
    expect(del).not.toHaveBeenCalled();
  });
});
