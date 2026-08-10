import { query } from './db';
import { vectorLiteral } from './embeddings';
import type { Article, ArticleAudio } from './types';

const PUBLIC_ARTICLE_COLUMNS = `
  id, source_feed, trigger_url, trigger_title, trigger_content, tags, persona,
  title, content_md, content_html, summary, seo_summary, slug, thumbnail_url,
  feedback, version, status, failed_from, error, claimed_at, created_at,
  updated_at, published_at, source_type, youtube_video_id
`;

export async function getPublishedArticles(tags: string[] = []): Promise<Article[]> {
  if (tags.length === 0) {
    return query<Article>(
      `SELECT ${PUBLIC_ARTICLE_COLUMNS}
       FROM articles
       WHERE status = 'published'
       ORDER BY published_at DESC`
    );
  }
  return query<Article>(
    `SELECT ${PUBLIC_ARTICLE_COLUMNS}
     FROM articles
     WHERE status = 'published'
       AND (tags->>'primary' = ANY($1::text[]) OR tags->'secondary' ?| $1::text[])
     ORDER BY published_at DESC`,
    [tags]
  );
}

export async function getPublishedArticlesForFeed(limit = 50): Promise<Article[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  return query<Article>(
    `SELECT ${PUBLIC_ARTICLE_COLUMNS}
     FROM articles
     WHERE status = 'published'
       AND title IS NOT NULL
       AND slug IS NOT NULL
       AND published_at IS NOT NULL
     ORDER BY published_at DESC, id DESC
     LIMIT $1`,
    [safeLimit]
  );
}

export async function getPublishedArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT ${PUBLIC_ARTICLE_COLUMNS}
     FROM articles
     WHERE status = 'published' AND slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getReadyArticleAudio(articleId: number): Promise<ArticleAudio | null> {
  const rows = await query<ArticleAudio>(
    `SELECT article_audio.*
     FROM article_audio
     JOIN articles ON articles.id = article_audio.article_id
     WHERE article_audio.article_id = $1
       AND article_audio.status = 'ready'
       AND article_audio.article_version = articles.version
       AND articles.status = 'published'`,
    [articleId]
  );
  return rows[0] ?? null;
}

export async function getPublishedArticlesByEmbedding(
  embedding: number[],
  model: string,
  tags: string[] = [],
  limit = 10
): Promise<Article[]> {
  const safeLimit = Math.min(25, Math.max(1, Math.trunc(limit)));
  const vector = vectorLiteral(embedding);

  if (tags.length === 0) {
    return query<Article>(
      `SELECT ${PUBLIC_ARTICLE_COLUMNS}
       FROM articles
       WHERE status = 'published'
         AND embedding IS NOT NULL
         AND embedding_model = $2
       ORDER BY embedding <=> $1::vector, published_at DESC
       LIMIT $3`,
      [vector, model, safeLimit]
    );
  }

  return query<Article>(
    `SELECT ${PUBLIC_ARTICLE_COLUMNS}
     FROM articles
     WHERE status = 'published'
       AND embedding IS NOT NULL
       AND embedding_model = $2
       AND (tags->>'primary' = ANY($3::text[]) OR tags->'secondary' ?| $3::text[])
     ORDER BY embedding <=> $1::vector, published_at DESC
     LIMIT $4`,
    [vector, model, tags, safeLimit]
  );
}
