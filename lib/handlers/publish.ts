import { query } from '../db';
import { structured } from '../llm';
import { loadPrompt } from '../prompts';
import { generateSlug } from '../slug';
import type { Article } from '../types';

interface SeoResult {
  seo_summary: string;
}

const SEO_SCHEMA = {
  type: 'object',
  properties: { seo_summary: { type: 'string' } },
  required: ['seo_summary'],
  additionalProperties: false,
};

async function slugExistsForOther(slug: string, id: number): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM articles WHERE slug = $1 AND id != $2`, [slug, id]);
  return rows.length > 0;
}

export async function publishHandler(article: Article): Promise<string> {
  const seo = await structured<SeoResult>(
    loadPrompt('seo-system'),
    loadPrompt('seo-user', { title: article.title ?? '', summary: article.summary ?? '' }),
    SEO_SCHEMA
  );

  const slug = await generateSlug(article.slug ?? article.title ?? String(article.id), (s) =>
    slugExistsForOther(s, article.id)
  );

  await query(
    `UPDATE articles SET
       seo_summary = $1, slug = $2, published_at = now(), status = 'published', claimed_at = NULL, updated_at = now()
     WHERE id = $3`,
    [seo.seo_summary.slice(0, 155), slug, article.id]
  );
  return 'published';
}
