import { query } from '../db';
import { structured } from '../llm';
import { loadPrompt } from '../prompts';
import { generateSlug } from '../slug';
import {
  articleEmbeddingText,
  createEmbedding,
  embeddingModelId,
  vectorLiteral,
} from '../embeddings';
import { enqueueArticleAudioById } from '../audio';
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
  const [seo, embedding] = await Promise.all([
    structured<SeoResult>(
      loadPrompt('seo-system'),
      loadPrompt('seo-user', { title: article.title ?? '', summary: article.summary ?? '' }),
      SEO_SCHEMA
    ),
    createEmbedding(articleEmbeddingText(article)),
  ]);

  const slug = await generateSlug(article.slug ?? article.title ?? String(article.id), (s) =>
    slugExistsForOther(s, article.id)
  );

  await query(
    `UPDATE articles SET
       seo_summary = $1,
       slug = $2,
       embedding = $3::vector,
       embedding_model = $4,
       embedded_at = now(),
       published_at = now(),
       status = 'published',
       claimed_at = NULL,
       updated_at = now()
     WHERE id = $5`,
    [
      seo.seo_summary.slice(0, 155),
      slug,
      vectorLiteral(embedding),
      embeddingModelId(),
      article.id,
    ]
  );

  // Publication is the editorial source of truth. Queue narration afterwards
  // and best-effort so a speech/queue outage can never roll a live article
  // back to "failed". The desk exposes a manual recovery button if this rare
  // enqueue step itself fails.
  try {
    const result = await enqueueArticleAudioById(article.id);
    if (!result.ok) {
      console.error(`[publish] could not queue audio for article ${article.id}: ${result.reason}`);
    }
  } catch (error) {
    console.error(`[publish] article ${article.id} is live but audio enqueue failed`, error);
  }
  return 'published';
}
