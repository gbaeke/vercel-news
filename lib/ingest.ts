import Parser from 'rss-parser';
import { query } from './db';
import { getFeeds, MAX_ITEMS_PER_POLL } from './feeds';
import { htmlToText } from './text';
import { enqueueArticle } from './articleQueue';
import { sendRssFirstReviewEmail } from './notify';
import type { Article } from './types';

export interface IngestDeps {
  fetchFeedXml?: (url: string) => Promise<string>;
  notifyFirstReview?: (article: Article) => Promise<boolean>;
}

async function defaultFetchFeedXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalNewsroom/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`feed fetch returned ${res.status}`);
  return res.text();
}

type FeedItem = { link?: string };

async function withoutDeleted<T extends FeedItem>(items: T[]): Promise<T[]> {
  const links = items.map((i) => i.link).filter((l): l is string => Boolean(l));
  if (links.length === 0) return items;
  const rows = await query<{ url: string }>(`SELECT url FROM deleted_urls WHERE url = ANY($1)`, [links]);
  if (rows.length === 0) return items;
  const deleted = new Set(rows.map((r) => r.url));
  return items.filter((i) => !i.link || !deleted.has(i.link));
}

export interface IngestFeedResult {
  feed: string;
  inserted: number;
  error?: string;
}

export async function ingestFeeds(deps: IngestDeps = {}): Promise<IngestFeedResult[]> {
  const fetchFeedXml = deps.fetchFeedXml ?? defaultFetchFeedXml;
  const notifyFirstReview = deps.notifyFirstReview ?? sendRssFirstReviewEmail;
  const parser = new Parser();
  const results: IngestFeedResult[] = [];

  const feeds = await getFeeds();
  for (const feed of feeds) {
    const [state] = await query<{ last_url: string | null }>(
      `SELECT last_url FROM feed_state WHERE feed_name = $1`,
      [feed.name]
    );
    const lastUrl = state?.last_url ?? null;

    let items: Awaited<ReturnType<typeof parser.parseString>>['items'];
    try {
      const xml = await fetchFeedXml(feed.url);
      const parsed = await parser.parseString(xml);
      items = parsed.items ?? [];
    } catch (err) {
      console.log(`[ingest] ${feed.name}: fetch or parse failed (${(err as Error).message})`);
      results.push({ feed: feed.name, inserted: 0, error: (err as Error).message });
      continue;
    }

    const fresh: typeof items = [];
    for (const item of items) {
      if (item.link && item.link === lastUrl) break;
      fresh.push(item);
    }

    // Drop operator-deleted URLs before the cap so a tombstoned item never
    // costs a real story its slot in this poll.
    const live = await withoutDeleted(fresh);
    const toInsert = live.slice(0, MAX_ITEMS_PER_POLL);
    let inserted = 0;

    for (const item of toInsert.slice().reverse()) {
      if (!item.link) continue;
      const provisional = item.contentSnippet ?? (item.content ? htmlToText(item.content) : null);
      const result = await enqueueArticle({
        sourceFeed: feed.name,
        url: item.link,
        title: item.title ?? null,
        content: provisional,
        requiresRssApproval: true,
      });
      if (result.outcome === 'inserted') {
        inserted += 1;
        try {
          const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [result.id]);
          if (article) await notifyFirstReview(article);
        } catch (error) {
          console.log(`[ingest] ${feed.name}: first-review email failed (${(error as Error).message})`);
        }
      }
    }

    const newest = items[0]?.link;
    if (newest) {
      await query(
        `INSERT INTO feed_state (feed_name, last_url) VALUES ($1, $2)
         ON CONFLICT (feed_name) DO UPDATE SET last_url = EXCLUDED.last_url`,
        [feed.name, newest]
      );
    }

    console.log(`[ingest] ${feed.name}: ${inserted} new item(s)`);
    results.push({ feed: feed.name, inserted });
  }

  return results;
}
