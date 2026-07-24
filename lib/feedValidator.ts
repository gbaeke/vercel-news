import Parser from 'rss-parser';

export type FeedValidation =
  | { ok: true; title: string; itemCount: number; warning?: string }
  | { ok: false; error: string };

export interface ValidatorDeps {
  fetchFeedXml?: (url: string) => Promise<string>;
}

const FETCH_TIMEOUT_MS = 10_000;

async function defaultFetchFeedXml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalNewsroom/1.0)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`feed returned HTTP ${res.status}`);
  return res.text();
}

export async function validateFeed(url: string, deps: ValidatorDeps = {}): Promise<FeedValidation> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return { ok: false, error: 'URL must use http or https' };
  }

  const fetchFeedXml = deps.fetchFeedXml ?? defaultFetchFeedXml;
  let xml: string;
  try {
    xml = await fetchFeedXml(url);
  } catch (err) {
    return { ok: false, error: `fetch failed: ${(err as Error).message}` };
  }

  let feed: Awaited<ReturnType<Parser['parseString']>>;
  try {
    feed = await new Parser().parseString(xml);
  } catch (err) {
    return { ok: false, error: `not a valid RSS/Atom feed: ${(err as Error).message}` };
  }

  const items = feed.items ?? [];
  const withLinks = items.filter((i) => i.link).length;
  // Ingest skips items without a link, so a feed where none have one is unusable.
  if (items.length > 0 && withLinks === 0) {
    return { ok: false, error: 'feed parses but none of its items have a link' };
  }

  return {
    ok: true,
    title: feed.title ?? '(untitled feed)',
    itemCount: items.length,
    warning: items.length === 0 ? 'feed is valid but currently has no items' : undefined,
  };
}
