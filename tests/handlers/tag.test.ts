import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  structured: vi.fn(),
}));

import { structured } from '../../lib/llm';
import { tagHandler } from '../../lib/handlers/tag';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, status)
     VALUES ('openai', 'https://example.com/y', 'some scraped text', 'scraped') RETURNING *`
  );
  return rows[0];
}

describe('tagHandler', () => {
  it('stores tags and moves to tagged when relevant', async () => {
    (structured as any).mockResolvedValue({ relevant: true, primary: 'models', secondary: ['research'] });
    const article = await insertArticle();

    const to = await tagHandler(article as any);
    expect(to).toBe('tagged');

    const [row] = await query<{ status: string; tags: any }>(
      `SELECT status, tags FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('tagged');
    expect(row.tags).toEqual({ primary: 'models', secondary: ['research'] });
  });

  it('throws (retryable failure) on malformed output instead of silently declining', async () => {
    (structured as any).mockResolvedValue({ primary_tag: 'industry', secondary_tags: [] });
    const article = await insertArticle();

    await expect(tagHandler(article as any)).rejects.toThrow(/malformed/);

    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('scraped');
  });

  it('declines automatically when the LLM says not relevant', async () => {
    (structured as any).mockResolvedValue({ relevant: false, primary: 'industry', secondary: [] });
    const article = await insertArticle();

    const to = await tagHandler(article as any);
    expect(to).toBe('declined');

    const [row] = await query<{ status: string; error: string }>(
      `SELECT status, error FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('declined');
    expect(row.error).toBeTruthy();
  });
});
