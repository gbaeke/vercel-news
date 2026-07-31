import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  complete: vi.fn(),
  structured: vi.fn(),
}));

import { complete, structured } from '../../lib/llm';
import { writeHandler } from '../../lib/handlers/write';
import { updateTagPersona } from '../../lib/tags';

async function insertArticle(triggerContent = 'source text') {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, tags, status)
     VALUES ('openai', 'https://example.com/z', $1, $2, 'tagged') RETURNING *`,
    [triggerContent, JSON.stringify({ primary: 'models', secondary: [] })]
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

    await updateTagPersona('models', 'research-explainer');
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
    expect(row.persona).toBe('research-explainer');
    expect((complete as any).mock.calls[0][0]).toContain('Patient explainer voice');
  });

  it('rejects a final draft that talks about the supplied source instead of the story', async () => {
    (complete as any)
      .mockResolvedValueOnce('draft body')
      .mockResolvedValueOnce('humanized body');
    (structured as any).mockResolvedValue({
      title: 'A New Model Arrives',
      content_md: 'The source material cuts off before the overage details.',
      summary: 'A short teaser.',
    });

    await updateTagPersona('models', 'research-explainer');
    const article = await insertArticle();
    await expect(writeHandler(article as any)).rejects.toThrow('refers to the supplied source');
  });

  it('does not append every source-document link to the finished story', async () => {
    (complete as any)
      .mockResolvedValueOnce('draft body')
      .mockResolvedValueOnce('humanized body');
    (structured as any).mockResolvedValue({
      title: 'A New Model Arrives',
      content_md: 'humanized body',
      summary: 'A short teaser.',
    });

    await updateTagPersona('models', 'research-explainer');
    const article = await insertArticle(
      'source text\n\nLinks from the original article:\n- [Technical details](https://example.com/details)'
    );
    await writeHandler(article as any);

    const [row] = await query<any>(`SELECT content_md FROM articles WHERE id = $1`, [article.id]);
    expect(row.content_md).toBe('humanized body');
  });

  it('routes an RSS draft to final review without generating a thumbnail', async () => {
    (complete as any)
      .mockResolvedValueOnce('draft body')
      .mockResolvedValueOnce('humanized body');
    (structured as any).mockResolvedValue({
      title: 'An RSS Draft',
      content_md: 'humanized body',
      summary: 'A draft teaser.',
    });

    const article = await insertArticle();
    await query(`UPDATE articles SET rss_approval_required = true WHERE id = $1`, [article.id]);
    const notify = vi.fn(async () => true);
    const to = await writeHandler({ ...article, rss_approval_required: true } as any, { notifyFinalReview: notify });

    expect(to).toBe('rss_final_review');
    expect(notify).toHaveBeenCalledOnce();
    const [row] = await query<any>(`SELECT status, thumbnail_url, content_md FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('rss_final_review');
    expect(row.thumbnail_url).toBeNull();
    expect(row.content_md).toBe('humanized body');
  });
});
