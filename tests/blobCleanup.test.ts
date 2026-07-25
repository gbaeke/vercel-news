import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import { isOwnThumbnailBlob, deleteThumbnailIfOrphaned } from '../lib/blobCleanup';

const BLOB = 'https://goqfoxxapkg8fkxt.public.blob.vercel-storage.com/thumbnails/7-1784897751935.png';

async function insertArticle(url: string, thumbnail: string | null) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, thumbnail_url, status)
     VALUES ('openai', $1, $2, 'published') RETURNING id`,
    [url, thumbnail]
  );
  return rows[0].id;
}

describe('isOwnThumbnailBlob', () => {
  it('accepts a thumbnail we uploaded to our blob store', () => {
    expect(isOwnThumbnailBlob(BLOB)).toBe(true);
  });

  it('rejects a placeholder data URL', () => {
    expect(isOwnThumbnailBlob('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
  });

  it('rejects anything outside our blob host, including look-alikes', () => {
    expect(isOwnThumbnailBlob('https://evil.example.com/thumbnails/1.png')).toBe(false);
    expect(isOwnThumbnailBlob('https://blob.vercel-storage.com.evil.com/thumbnails/1.png')).toBe(false);
    expect(isOwnThumbnailBlob('http://x.public.blob.vercel-storage.com/thumbnails/1.png')).toBe(false);
  });

  it('rejects blobs outside the thumbnails prefix', () => {
    expect(isOwnThumbnailBlob('https://x.public.blob.vercel-storage.com/backups/db.sql')).toBe(false);
  });

  it('rejects empty and malformed values', () => {
    expect(isOwnThumbnailBlob(null)).toBe(false);
    expect(isOwnThumbnailBlob('')).toBe(false);
    expect(isOwnThumbnailBlob('not a url')).toBe(false);
  });
});

describe('deleteThumbnailIfOrphaned', () => {
  it('deletes a thumbnail no article references any more', async () => {
    const del = vi.fn(async () => {});
    const removed = await deleteThumbnailIfOrphaned(BLOB, { del });
    expect(removed).toBe(true);
    expect(del).toHaveBeenCalledWith(BLOB);
  });

  // The whole point: a live article's image must survive.
  it('refuses to delete while any article still points at it', async () => {
    await insertArticle('https://example.com/live', BLOB);
    const del = vi.fn(async () => {});
    const removed = await deleteThumbnailIfOrphaned(BLOB, { del });
    expect(removed).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('refuses when a second article shares the same thumbnail', async () => {
    await insertArticle('https://example.com/one', BLOB);
    await insertArticle('https://example.com/two', BLOB);
    const del = vi.fn(async () => {});
    expect(await deleteThumbnailIfOrphaned(BLOB, { del })).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('never touches a placeholder', async () => {
    const del = vi.fn(async () => {});
    expect(await deleteThumbnailIfOrphaned('data:image/svg+xml;base64,abc', { del })).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('swallows a blob API failure rather than breaking the caller', async () => {
    const del = vi.fn(async () => { throw new Error('blob store unreachable'); });
    await expect(deleteThumbnailIfOrphaned(BLOB, { del })).resolves.toBe(false);
  });
});
