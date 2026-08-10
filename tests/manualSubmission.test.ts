import { describe, expect, it } from 'vitest';
import { query } from '../lib/db';
import { submitManualStory } from '../lib/manualSubmission';

describe('submitManualStory', () => {
  it('queues a valid URL exactly like a newly discovered feed item', async () => {
    const result = await submitManualStory('  https://www.example.com/news/story  ');

    expect(result).toMatchObject({
      ok: true,
      url: 'https://www.example.com/news/story',
      queue: { outcome: 'inserted', id: 1, status: 'new' },
    });
    const rows = await query<{
      source_feed: string;
      trigger_url: string;
      trigger_title: string | null;
      trigger_content: string | null;
      status: string;
    }>(
      `SELECT source_feed, trigger_url, trigger_title, trigger_content, status
       FROM articles`
    );
    expect(rows).toEqual([
      {
        source_feed: 'example.com',
        trigger_url: 'https://www.example.com/news/story',
        trigger_title: null,
        trigger_content: null,
        status: 'new',
      },
    ]);
  });

  it.each([
    ['', 'Enter a story URL.'],
    ['not a url', 'Enter a valid absolute URL.'],
    ['ftp://example.com/story', 'The story URL must use http or https.'],
    [
      'https://user:secret@example.com/story',
      'Story URLs cannot contain a username or password.',
    ],
  ])('rejects unsafe or invalid input: %s', async (url, error) => {
    await expect(submitManualStory(url)).resolves.toEqual({ ok: false, error });
    const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM articles`);
    expect(count).toBe('0');
  });

  it('returns the existing article when the URL is already queued', async () => {
    const first = await submitManualStory('https://example.com/duplicate');
    const second = await submitManualStory('https://example.com/duplicate');

    expect(first).toMatchObject({ ok: true, queue: { outcome: 'inserted', id: 1 } });
    expect(second).toMatchObject({
      ok: true,
      queue: { outcome: 'duplicate', id: 1, status: 'new' },
    });
    const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM articles`);
    expect(count).toBe('1');
  });

  it('canonicalizes YouTube URL variants and records video provenance', async () => {
    const first = await submitManualStory('https://youtu.be/dQw4w9WgXcQ?t=43');
    const second = await submitManualStory('https://www.youtube.com/shorts/dQw4w9WgXcQ');

    expect(first).toMatchObject({
      ok: true,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      queue: { outcome: 'inserted', id: 1 },
    });
    expect(second).toMatchObject({
      ok: true,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      queue: { outcome: 'duplicate', id: 1 },
    });
    const [row] = await query<{
      source_feed: string; trigger_url: string; source_type: string; youtube_video_id: string;
    }>(`SELECT source_feed, trigger_url, source_type, youtube_video_id FROM articles`);
    expect(row).toEqual({
      source_feed: 'youtube.com',
      trigger_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      source_type: 'youtube',
      youtube_video_id: 'dQw4w9WgXcQ',
    });
  });

  it('rejects a YouTube channel or playlist URL as a story URL', async () => {
    await expect(submitManualStory('https://www.youtube.com/@openai')).resolves.toEqual({
      ok: false,
      error: 'Enter a direct YouTube video URL, not a channel or playlist URL.',
    });
  });

  it('does not restore a URL the operator previously deleted', async () => {
    await query(`INSERT INTO deleted_urls (url) VALUES ($1)`, ['https://example.com/deleted']);

    const result = await submitManualStory('https://example.com/deleted');

    expect(result).toEqual({
      ok: true,
      url: 'https://example.com/deleted',
      queue: { outcome: 'deleted' },
    });
    const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM articles`);
    expect(count).toBe('0');
  });
});
