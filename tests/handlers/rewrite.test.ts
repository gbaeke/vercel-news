import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  complete: vi.fn(),
  structured: vi.fn(),
}));

import { complete, structured } from '../../lib/llm';
import { rewriteHandler } from '../../lib/handlers/rewrite';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles
       (source_feed, trigger_url, content_md, title, slug, feedback, version, status)
     VALUES ('openai', 'https://example.com/r', 'old body', 'Old Title', 'old-title', 'make it shorter', 1, 'rewrite_requested')
     RETURNING *`
  );
  return rows[0];
}

describe('rewriteHandler', () => {
  it('applies feedback, bumps version, and returns to in_review keeping the existing slug', async () => {
    (complete as any).mockResolvedValue('rewritten body');
    (structured as any).mockResolvedValue({
      title: 'Old Title',
      content_md: 'rewritten body',
      summary: 'shorter teaser',
    });

    const article = await insertArticle();
    const to = await rewriteHandler(article as any);
    expect(to).toBe('in_review');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('in_review');
    expect(row.version).toBe(2);
    expect(row.content_md).toBe('rewritten body');
    expect(row.slug).toBe('old-title');
  });
});
