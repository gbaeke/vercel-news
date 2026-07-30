import { describe, it, expect } from 'vitest';
import { query } from '../../lib/db';
import { extractStructuredArticleBody, scrapeHandler } from '../../lib/handlers/scrape';

async function insertArticle(overrides: Partial<{ trigger_content: string; source_rss_content: string; source_attempt_count: number }> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, source_rss_content, source_attempt_count, status)
     VALUES ('openai', 'https://example.com/x', $1, $2, $3, 'new') RETURNING *`,
    [
      overrides.trigger_content ?? null,
      overrides.source_rss_content ?? null,
      overrides.source_attempt_count ?? 0,
    ]
  );
  return rows[0];
}

const noWait = async () => {};

describe('scrapeHandler', () => {
  it('stores a substantive page extraction with its provenance', async () => {
    const article = await insertArticle();
    const longText = 'A'.repeat(500);
    const to = await scrapeHandler(article as any, { extract: async () => longText });
    expect(to).toBe('scraped');

    const [row] = await query<{
      status: string; trigger_content: string; source_extraction_method: string;
      source_content_length: number; source_attempt_count: number;
    }>(
      `SELECT status, trigger_content, source_extraction_method, source_content_length, source_attempt_count
       FROM articles WHERE id = $1`, [article.id]
    );
    expect(row).toMatchObject({
      status: 'scraped',
      trigger_content: longText,
      source_extraction_method: 'page',
      source_content_length: 500,
      source_attempt_count: 1,
    });
  });

  it('retries a weak page response before accepting a later complete extraction', async () => {
    const article = await insertArticle();
    let calls = 0;
    const to = await scrapeHandler(article as any, {
      extract: async () => (++calls === 1 ? 'too short' : 'A'.repeat(500)),
      sleep: noWait,
    });
    expect(to).toBe('scraped');
    expect(calls).toBe(2);
  });

  it('uses a substantive, non-truncated RSS body only as a documented fallback', async () => {
    const fallback = 'B'.repeat(600);
    const article = await insertArticle({ source_rss_content: fallback });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('scraped');

    const [row] = await query<{ trigger_content: string; source_extraction_method: string; source_fallback_reason: string }>(
      `SELECT trigger_content, source_extraction_method, source_fallback_reason FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).toBe(fallback);
    expect(row.source_extraction_method).toBe('rss-fallback');
    expect(row.source_fallback_reason).toContain('page extraction');
  });

  it('queues a truncated RSS preview for a delayed scrape retry instead of drafting from it', async () => {
    const preview = 'The Shared Pool: Every Copilot Business ($19/mo) and E... Update Type: Announcement, Services:';
    const article = await insertArticle({ source_rss_content: preview });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('scrape_retry');

    const [row] = await query<{
      status: string; source_attempt_count: number; source_fallback_reason: string; source_next_retry_at: string | null;
    }>(`SELECT status, source_attempt_count, source_fallback_reason, source_next_retry_at FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('scrape_retry');
    expect(row.source_attempt_count).toBe(1);
    expect(row.source_fallback_reason).toContain('truncated preview');
    expect(row.source_next_retry_at).not.toBeNull();
  });

  it('fails with an inspectable reason after three scrape cycles', async () => {
    const article = await insertArticle({ source_attempt_count: 2 });
    const to = await scrapeHandler(article as any, { extract: async () => null, sleep: noWait });
    expect(to).toBe('failed');

    const [row] = await query<{ status: string; failed_from: string; error: string; source_attempt_count: number }>(
      `SELECT status, failed_from, error, source_attempt_count FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('failed');
    expect(row.failed_from).toBe('new');
    expect(row.error).toContain('scrape failed after 3 cycles');
    expect(row.source_attempt_count).toBe(3);
  });

  it('strips HTML tags from extracted content before storing', async () => {
    const article = await insertArticle();
    const html = `<article><h1>Big News</h1><p>${'Real content. '.repeat(30)}</p><script>evil()</script></article>`;
    await scrapeHandler(article as any, { extract: async () => html });

    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).not.toContain('<');
    expect(row.trigger_content).toContain('Real content.');
    expect(row.trigger_content).not.toContain('evil()');
  });

  it('rejects an over-limit source and records that the safety limit fired', async () => {
    const article = await insertArticle();
    const to = await scrapeHandler(article as any, { extract: async () => 'C'.repeat(100_001), sleep: noWait });
    expect(to).toBe('scrape_retry');
    const [row] = await query<{ source_capped: boolean; trigger_content: string | null }>(
      `SELECT source_capped, trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.source_capped).toBe(true);
    expect(row.trigger_content).toBeNull();
  });

  it('extracts the largest Article JSON-LD body as a second strategy', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Article","articleBody":"short"}</script>
      <script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","articleBody":"${'Full article. '.repeat(50)}"}]}</script>
    `;
    expect(extractStructuredArticleBody(html)).toContain('Full article.');
  });
});
