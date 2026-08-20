import { describe, expect, it, vi } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleDiagramById,
  generateArticleDiagramById,
  getApprovedArticleDiagram,
  getArticleDiagram,
  generateArticleDiagram,
  parseArticleDiagramInput,
  updateArticleDiagramPlacementById,
  validateMermaidSource,
} from '../lib/articleDiagrams';
import type { Article } from '../lib/types';
import {
  countArticleParagraphs,
  splitArticleHtmlAfterParagraph,
} from '../lib/articleContentPlacement';

function diagramInput() {
  return {
    instructions: 'Explain how a request reaches the model and returns a response.',
    diagramType: 'flowchart' as const,
    direction: 'horizontal' as const,
    detail: 'standard' as const,
    look: 'classic' as const,
    placementAfterParagraph: 2,
  };
}

function sampleArticle(): Article {
  return {
    id: 1,
    source_feed: 'openai',
    trigger_url: 'https://example.com/diagram',
    trigger_title: null,
    trigger_content: null,
    source_rss_content: null,
    source_extraction_method: 'page',
    source_content_length: null,
    source_attempt_count: 0,
    source_last_attempt_at: null,
    source_next_retry_at: null,
    source_fallback_reason: null,
    source_capped: false,
    source_type: 'web',
    youtube_video_id: null,
    source_transcript: null,
    source_transcript_lang: null,
    source_provider: null,
    source_external_job_id: null,
    source_job_started_at: null,
    tags: null,
    persona: null,
    title: 'Gateway explainer',
    content_md: 'A client sends a request to a gateway. The gateway selects a model and returns the response.',
    content_html: null,
    summary: 'A model gateway routes requests.',
    seo_summary: null,
    slug: 'gateway-explainer',
    thumbnail_url: null,
    feedback: null,
    version: 1,
    rss_approval_required: false,
    status: 'published',
    failed_from: null,
    error: null,
    claimed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    published_at: new Date().toISOString(),
  };
}

async function insertArticle(status = 'in_review'): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (
       source_feed, trigger_url, title, summary, content_md, slug, status, published_at
     ) VALUES (
       'openai', 'https://example.com/diagram', 'Gateway explainer', 'A model gateway routes requests.',
       'A client sends a request to a gateway. The gateway selects a model and returns its response.',
       'gateway-explainer', $1, CASE WHEN $1 = 'published' THEN now() ELSE NULL END
     ) RETURNING id`,
    [status]
  );
  return rows[0].id;
}

describe('article diagrams', () => {
  it('repairs a generated diagram that violates the format rules once', async () => {
    const structured = vi.fn()
      .mockResolvedValueOnce({
        title: 'Request path',
        caption: 'The request path.',
        alt_text: 'A request path.',
        mermaid_source: 'flowchart LR\nA --> B\nstyle A fill:red',
      })
      .mockResolvedValueOnce({
        title: 'Request path',
        caption: 'The request path.',
        alt_text: 'A client request travels through a gateway to a model.',
        mermaid_source: 'flowchart LR\nA["Client"] --> B["Gateway"] --> C["Model"]',
      });

    await expect(generateArticleDiagram(sampleArticle(), diagramInput(), { structured }))
      .resolves.toMatchObject({
        title: 'Request path',
        mermaidSource: 'flowchart LR\nA["Client"] --> B["Gateway"] --> C["Model"]',
      });
    expect(structured).toHaveBeenCalledTimes(2);
    expect(structured.mock.calls[1][1]).toContain('Custom Mermaid styling is not allowed');
  });

  it('classifies an unusable repaired response as a validation failure', async () => {
    const structured = vi.fn().mockResolvedValue({
      title: 'Request path',
      caption: 'The request path.',
      alt_text: 'A request path.',
      mermaid_source: 'flowchart LR\nA --> B\nstyle A fill:red',
    });

    await expect(generateArticleDiagram(sampleArticle(), diagramInput(), { structured }))
      .rejects.toMatchObject({ stage: 'validation' });
    expect(structured).toHaveBeenCalledTimes(2);
  });

  it('classifies structured-output failures as model failures', async () => {
    const structured = vi.fn().mockRejectedValue(new Error('provider rejected structured output'));

    await expect(generateArticleDiagram(sampleArticle(), diagramInput(), { structured }))
      .rejects.toMatchObject({ stage: 'model' });
    expect(structured).toHaveBeenCalledTimes(1);
  });

  it('parses the editor controls with safe enum defaults', () => {
    const form = new FormData();
    form.set('instructions', 'Show the decision path.');
    form.set('diagram_type', 'not-a-type');
    form.set('direction', 'vertical');
    form.set('detail', 'simple');
    form.set('look', 'handDrawn');
    form.set('placement_after_paragraph', '2');

    expect(parseArticleDiagramInput(form)).toEqual({
      instructions: 'Show the decision path.',
      diagramType: 'auto',
      direction: 'vertical',
      detail: 'simple',
      look: 'handDrawn',
      placementAfterParagraph: 2,
    });
  });

  it('accepts semantic emphasis and rejects embedded configuration, links, or custom styling', () => {
    expect(validateMermaidSource('flowchart LR\n  A[Client] --> B[Gateway]')).toContain('flowchart LR');
    expect(validateMermaidSource('flowchart LR\n  A[Client] --> B[Gateway]\n  class B focal')).toContain('class B focal');
    expect(() => validateMermaidSource('%%{init: {"theme":"dark"}}%%\nflowchart LR\nA --> B')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nclick A "https://example.com"')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nstyle A fill:red')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA:::custom --> B')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nclass A custom')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nclass A,B,C focal')).toThrow();
  });

  it('creates a draft, approves it, and exposes it only for the current published article version', async () => {
    const id = await insertArticle('published');
    const result = await generateArticleDiagramById(id, diagramInput(), {
      generate: async () => ({
        title: 'Request path',
        caption: 'A request passes through the gateway to a selected model.',
        altText: 'Client sends a request to the gateway, which calls a model and returns the response.',
        mermaidSource: 'flowchart LR\n  A[Client] --> B[Gateway] --> C[Model]\n  C --> D[Response]',
      }),
    });

    expect(result.ok).toBe(true);
    expect((await getArticleDiagram(id))?.status).toBe('draft');
    expect(await getApprovedArticleDiagram(id)).toBeNull();

    await expect(approveArticleDiagramById(id)).resolves.toMatchObject({ ok: true });
    expect(await getApprovedArticleDiagram(id)).toMatchObject({
      title: 'Request path',
      placement_after_paragraph: 2,
    });

    await expect(updateArticleDiagramPlacementById(id, 1)).resolves.toMatchObject({ ok: true });
    expect((await getArticleDiagram(id))?.status).toBe('draft');
    expect(await getApprovedArticleDiagram(id)).toBeNull();
    await approveArticleDiagramById(id);
    expect((await getApprovedArticleDiagram(id))?.placement_after_paragraph).toBe(1);

    await query(`UPDATE articles SET version = version + 1 WHERE id = $1`, [id]);
    expect(await getApprovedArticleDiagram(id)).toBeNull();
  });

  it('refuses approval after the article changes', async () => {
    const id = await insertArticle();
    await generateArticleDiagramById(id, diagramInput(), {
      generate: async () => ({
        title: 'Request path',
        caption: 'The request path.',
        altText: 'Client sends a request through a gateway to a model.',
        mermaidSource: 'flowchart LR\n  A[Client] --> B[Gateway] --> C[Model]',
      }),
    });
    await query(`UPDATE articles SET version = version + 1 WHERE id = $1`, [id]);

    await expect(approveArticleDiagramById(id)).resolves.toEqual({
      ok: false,
      reason: 'stale_version',
      message: 'The article changed after this diagram was generated. Regenerate it before approval.',
    });
  });

  it('counts paragraphs and splits immediately after the selected paragraph', () => {
    const html = '<p>One</p><h2>Middle</h2><p>Two</p><p>Three</p>';
    expect(countArticleParagraphs(html)).toBe(3);
    expect(splitArticleHtmlAfterParagraph(html, 2)).toEqual({
      beforeHtml: '<p>One</p><h2>Middle</h2><p>Two</p>',
      afterHtml: '<p>Three</p>',
    });
    expect(splitArticleHtmlAfterParagraph(html, 10)).toEqual({
      beforeHtml: html,
      afterHtml: '',
    });
  });
});
