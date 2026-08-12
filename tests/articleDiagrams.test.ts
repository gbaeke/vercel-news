import { describe, expect, it } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleDiagramById,
  generateArticleDiagramById,
  getApprovedArticleDiagram,
  getArticleDiagram,
  parseArticleDiagramInput,
  updateArticleDiagramPlacementById,
  validateMermaidSource,
} from '../lib/articleDiagrams';
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

  it('accepts focused Mermaid and rejects embedded configuration or links', () => {
    expect(validateMermaidSource('flowchart LR\n  A[Client] --> B[Gateway]')).toContain('flowchart LR');
    expect(() => validateMermaidSource('%%{init: {"theme":"dark"}}%%\nflowchart LR\nA --> B')).toThrow();
    expect(() => validateMermaidSource('flowchart LR\nA --> B\nclick A "https://example.com"')).toThrow();
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
