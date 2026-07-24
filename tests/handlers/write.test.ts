import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  complete: vi.fn(),
  structured: vi.fn(),
}));

import { complete, structured } from '../../lib/llm';
import { writeHandler } from '../../lib/handlers/write';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, tags, status)
     VALUES ('openai', 'https://example.com/z', 'source text', $1, 'tagged') RETURNING *`,
    [JSON.stringify({ primary: 'models', secondary: [] })]
  );
  return rows[0];
}

describe('writeHandler', () => {
  it('writes title, content_md, content_html, summary, slug, persona, status=written in one UPDATE', async () => {
    (complete as any)
      .mockResolvedValueOnce('draft body')
      .mockResolvedValueOnce('humanized body');
    (structured as any).mockResolvedValue({
      title: 'A New Model Arrives',
      content_md: 'humanized body',
      summary: 'A short teaser.',
    });

    const article = await insertArticle();
    const to = await writeHandler(article as any);
    expect(to).toBe('written');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('written');
    expect(row.title).toBe('A New Model Arrives');
    expect(row.content_md).toBe('humanized body');
    expect(row.content_html).toContain('humanized body');
    expect(row.summary).toBe('A short teaser.');
    expect(row.slug).toBe('a-new-model-arrives');
    expect(row.persona).toBeTruthy();
  });
});
