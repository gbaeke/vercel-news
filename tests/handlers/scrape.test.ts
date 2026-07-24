import { describe, it, expect } from 'vitest';
import { query } from '../../lib/db';
import { scrapeHandler } from '../../lib/handlers/scrape';

async function insertArticle(overrides: Partial<{ trigger_content: string }> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, status)
     VALUES ('openai', 'https://example.com/x', $1, 'new') RETURNING *`,
    [overrides.trigger_content ?? null]
  );
  return rows[0];
}

describe('scrapeHandler', () => {
  it('stores extracted content and returns scraped when extraction succeeds', async () => {
    const article = await insertArticle();
    const longText = 'A'.repeat(500);
    const to = await scrapeHandler(article as any, { extract: async () => longText });
    expect(to).toBe('scraped');

    const [row] = await query<{ status: string; trigger_content: string }>(
      `SELECT status, trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('scraped');
    expect(row.trigger_content).toBe(longText);
  });

  it('falls back to the RSS body when extraction yields under 200 chars', async () => {
    const article = await insertArticle({ trigger_content: 'B'.repeat(300) });
    const to = await scrapeHandler(article as any, { extract: async () => 'too short' });
    expect(to).toBe('scraped');

    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).toBe('B'.repeat(300));
  });

  it('accepts a short-but-real RSS description as last resort (under 200 chars is fine)', async () => {
    const shortDescription = 'A new model was released today with faster inference and lower prices for developers building on the API.';
    const article = await insertArticle({ trigger_content: shortDescription });
    const to = await scrapeHandler(article as any, { extract: async () => null });
    expect(to).toBe('scraped');
  });

  it('throws when both extraction and RSS fallback yield nothing usable', async () => {
    const article = await insertArticle({ trigger_content: null as any });
    await expect(scrapeHandler(article as any, { extract: async () => null })).rejects.toThrow();
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

  it('caps stored text at ~30 kB', async () => {
    const article = await insertArticle();
    const huge = 'C'.repeat(40_000);
    await scrapeHandler(article as any, { extract: async () => huge });
    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content.length).toBeLessThanOrEqual(30_000);
  });
});
