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
