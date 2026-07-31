import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';
import { getFeeds } from '../lib/feeds';
import { deleteArticleById } from '../lib/reviewActions';

function rss(items: { title: string; link: string; description: string }[]) {
  const entries = items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

describe('ingestFeeds', () => {
  it('inserts at most MAX_ITEMS_PER_POLL newest items into first review', async () => {
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
    expect(rows.every((r) => r.status === 'rss_pending_review')).toBe(true);
  });

  it('emails each newly discovered RSS item with its source preview', async () => {
    const notified: number[] = [];
    const xml = rss([{ title: 'Needs review', link: 'https://example.com/review-me', description: 'A useful feed description.' }]);

    await ingestFeeds({
      fetchFeedXml: async () => xml,
      notifyFirstReview: async (article) => {
        notified.push(article.id);
        expect(article.status).toBe('rss_pending_review');
        expect(article.trigger_title).toBe('Needs review');
        expect(article.trigger_content).toContain('A useful feed description.');
        return true;
      },
    });

    expect(notified).toHaveLength(1);
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

  // The unique constraint on trigger_url is not enough: once the row is gone a
  // feed that reorders the item back above the last-seen marker would re-ingest
  // it. The suppression list is what makes a delete permanent.
  it('never re-inserts a URL the operator deleted, even when the feed reorders it to the top', async () => {
    const first = rss([
      { title: 'Newest', link: 'https://example.com/keep', description: 'd' },
      { title: 'Older', link: 'https://example.com/killed', description: 'd' },
    ]);
    await ingestFeeds({ fetchFeedXml: async () => first });

    const [doomed] = await query<{ id: number }>(
      `SELECT id FROM articles WHERE trigger_url = 'https://example.com/killed' LIMIT 1`
    );
    await deleteArticleById(doomed.id);

    // Same two items, but the deleted one is now newest — so the last-seen
    // marker no longer shields it.
    const reordered = rss([
      { title: 'Older', link: 'https://example.com/killed', description: 'd' },
      { title: 'Newest', link: 'https://example.com/keep', description: 'd' },
    ]);
    await ingestFeeds({ fetchFeedXml: async () => reordered });

    const rows = await query<{ trigger_url: string }>(
      `SELECT trigger_url FROM articles WHERE trigger_url = 'https://example.com/killed'`
    );
    expect(rows).toEqual([]);
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
    expect(results.filter((r) => !r.error).reduce((total, r) => total + r.inserted, 0)).toBe(1);
  });

  it('puts a timeout signal on real feed requests', async () => {
    const signals: AbortSignal[] = [];
    const xml = rss([]);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      return new Response(xml, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await ingestFeeds();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });
});
