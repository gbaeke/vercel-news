import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';
import { getFeeds } from '../lib/feeds';

function rss(items: { title: string; link: string; description: string }[]) {
  const entries = items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

describe('ingestFeeds', () => {
  it('inserts at most MAX_ITEMS_PER_POLL newest items as status=new', async () => {
    const xml = rss([
      { title: 'Newest', link: 'https://example.com/3', description: 'd3' },
      { title: 'Middle', link: 'https://example.com/2', description: 'd2' },
      { title: 'Oldest', link: 'https://example.com/1', description: 'd1' },
    ]);

    await ingestFeeds({ fetchFeedXml: async () => xml });

    const rows = await query<{ trigger_url: string; status: string }>(
      `SELECT trigger_url, status FROM articles ORDER BY trigger_url`
    );
    expect(rows.map((r) => r.trigger_url)).toEqual(['https://example.com/2', 'https://example.com/3']);
    expect(rows.every((r) => r.status === 'new')).toBe(true);
  });

  it('stops at the last-seen URL and does not re-insert on a second poll', async () => {
    const xml = rss([
      { title: 'Newest', link: 'https://example.com/3', description: 'd3' },
      { title: 'Middle', link: 'https://example.com/2', description: 'd2' },
    ]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await ingestFeeds({ fetchFeedXml: async () => xml });

    const rows = await query(`SELECT trigger_url FROM articles`);
    expect(rows.length).toBe(2);
  });

  it('is a no-op backfill guard against a large historical feed (only 2 land, not 200)', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      title: `Item ${i}`,
      link: `https://example.com/hist-${i}`,
      description: 'd',
    }));
    await ingestFeeds({ fetchFeedXml: async () => rss(items) });

    const rows = await query(`SELECT trigger_url FROM articles`);
    expect(rows.length).toBe(2);
  });

  it('keeps ingesting the remaining feeds when one feed returns unparseable content (e.g. a 404 HTML page)', async () => {
    const feeds = await getFeeds();
    const brokenFeedName = feeds[feeds.length - 1].name;
    const okXml = rss([{ title: 'Ok Item', link: 'https://example.com/ok-1', description: 'd' }]);
    const html404 = '<!DOCTYPE html><html><body>Not Found</body></html>';

    const results = await ingestFeeds({
      fetchFeedXml: async (url) => {
        const feed = feeds.find((f) => f.url === url);
        return feed?.name === brokenFeedName ? html404 : okXml;
      },
    });

    const rows = await query<{ trigger_url: string }>(`SELECT trigger_url FROM articles`);
    expect(rows.map((r) => r.trigger_url)).toContain('https://example.com/ok-1');

    const broken = results.find((r) => r.feed === brokenFeedName);
    expect(broken?.inserted).toBe(0);
    expect(broken?.error).toBeTruthy();
    expect(results.filter((r) => !r.error).every((r) => r.inserted === 1)).toBe(true);
  });
});
