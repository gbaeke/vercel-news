import Parser from 'rss-parser';
import { query } from './db';
import { FEEDS, MAX_ITEMS_PER_POLL } from './feeds';
import { htmlToText } from './text';

export interface IngestDeps {
  fetchFeedXml?: (url: string) => Promise<string>;
}

async function defaultFetchFeedXml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalNewsroom/1.0)' } });
  if (!res.ok) throw new Error(`feed fetch returned ${res.status}`);
  return res.text();
}

export async function ingestFeeds(deps: IngestDeps = {}): Promise<void> {
  const fetchFeedXml = deps.fetchFeedXml ?? defaultFetchFeedXml;
  const parser = new Parser();

  for (const feed of FEEDS) {
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
      continue;
    }

    const fresh: typeof items = [];
    for (const item of items) {
      if (item.link && item.link === lastUrl) break;
      fresh.push(item);
    }

    const toInsert = fresh.slice(0, MAX_ITEMS_PER_POLL);

    for (const item of toInsert.slice().reverse()) {
      if (!item.link) continue;
      const provisional = item.contentSnippet ?? (item.content ? htmlToText(item.content) : null);
      await query(
        `INSERT INTO articles (source_feed, trigger_url, trigger_title, trigger_content, status)
         VALUES ($1, $2, $3, $4, 'new')
         ON CONFLICT (trigger_url) DO NOTHING`,
        [feed.name, item.link, item.title ?? null, provisional]
      );
    }

    const newest = items[0]?.link;
    if (newest) {
      await query(
        `INSERT INTO feed_state (feed_name, last_url) VALUES ($1, $2)
         ON CONFLICT (feed_name) DO UPDATE SET last_url = EXCLUDED.last_url`,
        [feed.name, newest]
      );
    }

    console.log(`[ingest] ${feed.name}: ${toInsert.length} new item(s)`);
  }
}
