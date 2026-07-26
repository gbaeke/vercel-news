import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  structured: vi.fn(),
}));

import { structured } from '../../lib/llm';
import { publishHandler } from '../../lib/handlers/publish';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, title, summary, slug, status)
     VALUES ('openai', 'https://example.com/p', 'Great Title', 'Summary text', 'great-title', 'approved')
     RETURNING *`
  );
  return rows[0];
}

describe('publishHandler', () => {
  it('sets SEO, embedding metadata, published_at, and status=published', async () => {
    (structured as any).mockResolvedValue({ seo_summary: 'A short meta description.' });
    const article = await insertArticle();

    const to = await publishHandler(article as any);
    expect(to).toBe('published');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('published');
    expect(row.seo_summary).toBe('A short meta description.');
    expect(row.published_at).not.toBeNull();
    expect(row.slug).toBe('great-title');
    expect(row.embedding).toBeTruthy();
    expect(row.embedding_model).toBe('openai/text-embedding-3-small');
    expect(row.embedded_at).not.toBeNull();
  });
});
