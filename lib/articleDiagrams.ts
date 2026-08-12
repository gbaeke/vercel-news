import { query } from './db';
import { structured } from './llm';
import { loadPrompt } from './prompts';
import type {
  Article,
  ArticleDiagram,
  ArticleDiagramDetail,
  ArticleDiagramDirection,
  ArticleDiagramLook,
  ArticleDiagramType,
} from './types';

export interface ArticleDiagramInput {
  instructions: string;
  diagramType: ArticleDiagramType;
  direction: ArticleDiagramDirection;
  detail: ArticleDiagramDetail;
  look: ArticleDiagramLook;
  placementAfterParagraph: number;
}

export interface GeneratedArticleDiagram {
  title: string;
  caption: string;
  altText: string;
  mermaidSource: string;
}

export interface EditableArticleDiagram extends ArticleDiagramInput, GeneratedArticleDiagram {}

type DiagramFailureReason =
  | 'not_found'
  | 'invalid_state'
  | 'invalid_input'
  | 'stale_version';

export type DiagramMutationResult =
  | { ok: true; diagram?: ArticleDiagram }
  | { ok: false; reason: DiagramFailureReason; message: string };

interface GenerateDeps {
  generate?: (
    article: Article,
    input: ArticleDiagramInput
  ) => Promise<GeneratedArticleDiagram>;
}

const DIAGRAM_TYPES = ['auto', 'flowchart', 'sequence', 'relationship', 'architecture'] as const;
const DIRECTIONS = ['auto', 'horizontal', 'vertical'] as const;
const DETAILS = ['simple', 'standard', 'detailed'] as const;
const LOOKS = ['classic', 'handDrawn'] as const;
const EDITABLE_ARTICLE_STATUSES = ['in_review', 'rss_final_review', 'published'];
const MAX_INSTRUCTIONS_LENGTH = 1_500;
const MAX_MERMAID_LENGTH = 12_000;
const MAX_PLACEMENT_PARAGRAPH = 1_000;

const DIAGRAM_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    caption: { type: 'string' },
    alt_text: { type: 'string' },
    mermaid_source: { type: 'string' },
  },
  required: ['title', 'caption', 'alt_text', 'mermaid_source'],
  additionalProperties: false,
};

function enumValue<T extends readonly string[]>(
  value: FormDataEntryValue | null,
  allowed: T,
  fallback: T[number]
): T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number])
    ? value as T[number]
    : fallback;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const text = value.trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
  return text;
}

export function parseArticleDiagramInput(formData: FormData): ArticleDiagramInput {
  return {
    instructions: boundedText(
      formData.get('instructions'),
      'Diagram instructions',
      MAX_INSTRUCTIONS_LENGTH
    ),
    diagramType: enumValue(formData.get('diagram_type'), DIAGRAM_TYPES, 'auto'),
    direction: enumValue(formData.get('direction'), DIRECTIONS, 'auto'),
    detail: enumValue(formData.get('detail'), DETAILS, 'standard'),
    look: enumValue(formData.get('look'), LOOKS, 'classic'),
    placementAfterParagraph: parsePlacementAfterParagraph(
      formData.get('placement_after_paragraph')
    ),
  };
}

export function parsePlacementAfterParagraph(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const paragraph = Number(value);
  if (!Number.isInteger(paragraph) || paragraph < 0 || paragraph > MAX_PLACEMENT_PARAGRAPH) {
    throw new Error(`Diagram placement must be between 0 and ${MAX_PLACEMENT_PARAGRAPH.toLocaleString()}.`);
  }
  return paragraph;
}

function withoutMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export function validateMermaidSource(value: unknown): string {
  const source = boundedText(value, 'Mermaid source', MAX_MERMAID_LENGTH);
  const normalized = withoutMarkdownFence(source);
  const firstLine = normalized.split(/\r?\n/, 1)[0]?.trim() ?? '';

  if (!/^(flowchart\s+(TD|TB|LR|RL)|sequenceDiagram)$/i.test(firstLine)) {
    throw new Error('Mermaid source must begin with a flowchart direction or sequenceDiagram.');
  }
  if (/^---\s*$/m.test(normalized) || /%%\s*\{/i.test(normalized)) {
    throw new Error('Diagram-level configuration is controlled by the site, not Mermaid source.');
  }
  if (/^\s*(click|link)\s+/im.test(normalized)) {
    throw new Error('Interactive links are not allowed in article diagrams.');
  }
  if (/<\/?[a-z][^>]*>/i.test(normalized)) {
    throw new Error('HTML is not allowed in article diagrams.');
  }
  return normalized;
}

function cleanGeneratedDiagram(value: {
  title: unknown;
  caption: unknown;
  alt_text: unknown;
  mermaid_source: unknown;
}): GeneratedArticleDiagram {
  return {
    title: boundedText(value.title, 'Diagram title', 120),
    caption: boundedText(value.caption, 'Diagram caption', 300),
    altText: boundedText(value.alt_text, 'Diagram alt text', 500),
    mermaidSource: validateMermaidSource(value.mermaid_source),
  };
}

export async function generateArticleDiagram(
  article: Article,
  input: ArticleDiagramInput
): Promise<GeneratedArticleDiagram> {
  const generated = await structured<{
    title: string;
    caption: string;
    alt_text: string;
    mermaid_source: string;
  }>(
    loadPrompt('diagram-system'),
    loadPrompt('diagram-user', {
      title: article.title ?? article.trigger_title ?? 'Untitled article',
      summary: article.summary ?? '',
      body: (article.content_md ?? article.trigger_content ?? '').slice(0, 18_000),
      instructions: input.instructions,
      diagram_type: input.diagramType,
      direction: input.direction,
      detail: input.detail,
    }),
    DIAGRAM_SCHEMA
  );
  return cleanGeneratedDiagram(generated);
}

export function parseEditableArticleDiagram(formData: FormData): EditableArticleDiagram {
  const input = parseArticleDiagramInput(formData);
  return {
    ...input,
    title: boundedText(formData.get('title'), 'Diagram title', 120),
    caption: boundedText(formData.get('caption'), 'Diagram caption', 300),
    altText: boundedText(formData.get('alt_text'), 'Diagram alt text', 500),
    mermaidSource: validateMermaidSource(formData.get('mermaid_source')),
  };
}

export async function getArticleDiagram(articleId: number): Promise<ArticleDiagram | null> {
  const rows = await query<ArticleDiagram>(
    `SELECT * FROM article_diagrams WHERE article_id = $1`,
    [articleId]
  );
  return rows[0] ?? null;
}

export async function getApprovedArticleDiagram(articleId: number): Promise<ArticleDiagram | null> {
  const rows = await query<ArticleDiagram>(
    `SELECT article_diagrams.*
     FROM article_diagrams
     JOIN articles ON articles.id = article_diagrams.article_id
     WHERE article_diagrams.article_id = $1
       AND article_diagrams.status = 'approved'
       AND article_diagrams.article_version = articles.version
       AND articles.status = 'published'`,
    [articleId]
  );
  return rows[0] ?? null;
}

async function editableArticle(id: number): Promise<Article | null> {
  const rows = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

function articleFailure(article: Article | null): DiagramMutationResult | null {
  if (!article) return { ok: false, reason: 'not_found', message: 'That article no longer exists.' };
  if (!EDITABLE_ARTICLE_STATUSES.includes(article.status)) {
    return {
      ok: false,
      reason: 'invalid_state',
      message: `Diagrams cannot be edited while the article is “${article.status}”.`,
    };
  }
  if (!article.content_md && !article.trigger_content) {
    return {
      ok: false,
      reason: 'invalid_state',
      message: 'This article does not have enough content for a diagram yet.',
    };
  }
  return null;
}

async function upsertDraft(
  article: Article,
  input: ArticleDiagramInput,
  generated: GeneratedArticleDiagram
): Promise<ArticleDiagram> {
  const rows = await query<ArticleDiagram>(
    `INSERT INTO article_diagrams (
       article_id, article_version, status, instructions, diagram_type,
       direction, detail, look, placement_after_paragraph, title, caption,
       alt_text, mermaid_source
     ) VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (article_id) DO UPDATE SET
       article_version = EXCLUDED.article_version,
       status = 'draft', instructions = EXCLUDED.instructions,
       diagram_type = EXCLUDED.diagram_type, direction = EXCLUDED.direction,
       detail = EXCLUDED.detail, look = EXCLUDED.look,
       placement_after_paragraph = EXCLUDED.placement_after_paragraph,
       title = EXCLUDED.title, caption = EXCLUDED.caption, alt_text = EXCLUDED.alt_text,
       mermaid_source = EXCLUDED.mermaid_source, generated_at = now(),
       approved_at = NULL, updated_at = now()
     RETURNING *`,
    [
      article.id,
      article.version,
      input.instructions,
      input.diagramType,
      input.direction,
      input.detail,
      input.look,
      input.placementAfterParagraph,
      generated.title,
      generated.caption,
      generated.altText,
      generated.mermaidSource,
    ]
  );
  return rows[0];
}

export async function generateArticleDiagramById(
  id: number,
  input: ArticleDiagramInput,
  deps: GenerateDeps = {}
): Promise<DiagramMutationResult> {
  const article = await editableArticle(id);
  const failure = articleFailure(article);
  if (failure) return failure;

  const generated = await (deps.generate ?? generateArticleDiagram)(article!, input);
  const cleaned = cleanGeneratedDiagram({
    title: generated.title,
    caption: generated.caption,
    alt_text: generated.altText,
    mermaid_source: generated.mermaidSource,
  });
  const diagram = await upsertDraft(article!, input, cleaned);
  return { ok: true, diagram };
}

export async function saveArticleDiagramById(
  id: number,
  edited: EditableArticleDiagram
): Promise<DiagramMutationResult> {
  const article = await editableArticle(id);
  const failure = articleFailure(article);
  if (failure) return failure;
  const existing = await getArticleDiagram(id);
  if (!existing) {
    return { ok: false, reason: 'not_found', message: 'Generate a diagram before editing it.' };
  }

  const diagram = await upsertDraft(article!, edited, edited);
  return { ok: true, diagram };
}

export async function approveArticleDiagramById(id: number): Promise<DiagramMutationResult> {
  const rows = await query<ArticleDiagram>(
    `UPDATE article_diagrams
     SET status = 'approved', approved_at = now(), updated_at = now()
     FROM articles
     WHERE article_diagrams.article_id = $1
       AND articles.id = article_diagrams.article_id
       AND article_diagrams.article_version = articles.version
       AND articles.status IN ('in_review', 'rss_final_review', 'published')
     RETURNING article_diagrams.*`,
    [id]
  );
  if (rows[0]) return { ok: true, diagram: rows[0] };

  const [diagram, article] = await Promise.all([getArticleDiagram(id), editableArticle(id)]);
  if (!article || !diagram) {
    return { ok: false, reason: 'not_found', message: 'That diagram no longer exists.' };
  }
  if (diagram.article_version !== article.version) {
    return {
      ok: false,
      reason: 'stale_version',
      message: 'The article changed after this diagram was generated. Regenerate it before approval.',
    };
  }
  return articleFailure(article) ?? {
    ok: false,
    reason: 'invalid_state',
    message: 'The diagram could not be approved in the current article state.',
  };
}

export async function updateArticleDiagramPlacementById(
  id: number,
  placementAfterParagraph: number
): Promise<DiagramMutationResult> {
  const article = await editableArticle(id);
  const failure = articleFailure(article);
  if (failure) return failure;
  const placement = parsePlacementAfterParagraph(placementAfterParagraph);

  const rows = await query<ArticleDiagram>(
    `UPDATE article_diagrams
     SET placement_after_paragraph = $1,
         article_version = $2,
         status = 'draft',
         approved_at = NULL,
         updated_at = now()
     WHERE article_id = $3
     RETURNING *`,
    [placement, article!.version, id]
  );
  return rows[0]
    ? { ok: true, diagram: rows[0] }
    : { ok: false, reason: 'not_found', message: 'Generate a diagram before placing it.' };
}

export async function deleteArticleDiagramById(id: number): Promise<DiagramMutationResult> {
  const rows = await query<{ article_id: number }>(
    `DELETE FROM article_diagrams WHERE article_id = $1 RETURNING article_id`,
    [id]
  );
  return rows[0]
    ? { ok: true }
    : { ok: false, reason: 'not_found', message: 'That diagram no longer exists.' };
}
