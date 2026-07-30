import { query } from '../db';
import { complete, structured } from '../llm';
import { loadPrompt } from '../prompts';
import { resolvePersona } from '../personas';
import { getTagPersonaId } from '../tags';
import { generateSlug } from '../slug';
import { renderMarkdown } from '../markdown';
import { containsSourceProcessLanguage, sourceForPrompt } from '../sourceQuality';
import type { Article } from '../types';

interface FinishResult {
  title: string;
  content_md: string;
  summary: string;
}

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content_md: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'content_md', 'summary'],
  additionalProperties: false,
};

async function slugExists(slug: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM articles WHERE slug = $1`, [slug]);
  return rows.length > 0;
}

export async function writeHandler(article: Article): Promise<string> {
  const primaryTag = article.tags?.primary ?? 'industry';
  const personaId = await getTagPersonaId(primaryTag);
  const persona = resolvePersona(personaId);
  if (!personaId || persona.name !== personaId) {
    console.warn(
      `[write] tag "${primaryTag}" has no valid persona assignment; using "${persona.name}"`
    );
  }

  const draft = await complete(
    loadPrompt('draft-system', { persona_style: persona.style }),
    loadPrompt('draft-user', { content: sourceForPrompt(article.trigger_content ?? '') })
  );

  const humanized = await complete(
    loadPrompt('humanize-system'),
    loadPrompt('humanize-user', { draft })
  );

  const finished = await structured<FinishResult>(
    loadPrompt('finish-system'),
    loadPrompt('finish-user', { content: humanized }),
    FINISH_SCHEMA
  );

  if (containsSourceProcessLanguage(finished.title)
    || containsSourceProcessLanguage(finished.content_md)
    || containsSourceProcessLanguage(finished.summary)) {
    throw new Error('draft refers to the supplied source instead of reporting the story');
  }

  const contentHtml = renderMarkdown(finished.content_md);
  const slug = await generateSlug(finished.title, slugExists);

  await query(
    `UPDATE articles SET
       persona = $1, title = $2, content_md = $3, content_html = $4,
       summary = $5, slug = $6, status = 'written', claimed_at = NULL, updated_at = now()
     WHERE id = $7`,
    [persona.name, finished.title, finished.content_md, contentHtml, finished.summary, slug, article.id]
  );
  return 'written';
}
