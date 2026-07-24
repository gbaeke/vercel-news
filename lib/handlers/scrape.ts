import { extractFromHtml } from '@extractus/article-extractor';
import { query } from '../db';
import { htmlToText } from '../text';
import type { Article } from '../types';

const MIN_USABLE_LENGTH = 200;
// The RSS description is the last resort before failing, so it only needs to
// be non-trivial (spec §6 puts the 200-char bar on extraction, not on it).
const MIN_FALLBACK_LENGTH = 50;
const MAX_STORED_LENGTH = 30_000;

export interface ScrapeDeps {
  extract?: (url: string) => Promise<string | null>;
}

async function defaultExtract(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const article = await extractFromHtml(html, url);
  return article?.content ?? null;
}

export async function scrapeHandler(article: Article, deps: ScrapeDeps = {}): Promise<string> {
  const extract = deps.extract ?? defaultExtract;

  let content: string | null = null;
  let layer = 'none';

  try {
    const extracted = await extract(article.trigger_url);
    const asText = extracted ? htmlToText(extracted) : '';
    if (asText.length >= MIN_USABLE_LENGTH) {
      content = asText;
      layer = 'fetch+extract';
    }
  } catch (err) {
    console.log(`[scrape] article ${article.id}: fetch+extract failed (${(err as Error).message})`);
  }

  if (!content && article.trigger_content) {
    const fallback = htmlToText(article.trigger_content);
    if (fallback.length >= MIN_FALLBACK_LENGTH) {
      content = fallback;
      layer = 'rss-body-fallback';
    }
  }

  if (!content) {
    throw new Error('scrape failed: no usable content from fetch+extract or RSS body fallback');
  }

  console.log(`[scrape] article ${article.id}: succeeded via ${layer}`);

  const capped = content.slice(0, MAX_STORED_LENGTH);
  await query(
    `UPDATE articles SET trigger_content = $1, status = 'scraped', claimed_at = NULL, updated_at = now() WHERE id = $2`,
    [capped, article.id]
  );
  return 'scraped';
}
