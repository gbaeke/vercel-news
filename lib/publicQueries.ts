import { query } from './db';
import type { Article } from './types';

export async function getPublishedArticles(tags: string[] = []): Promise<Article[]> {
  if (tags.length === 0) {
    return query<Article>(
      `SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC`
    );
  }
  return query<Article>(
    `SELECT * FROM articles
     WHERE status = 'published'
       AND (tags->>'primary' = ANY($1::text[]) OR tags->'secondary' ?| $1::text[])
     ORDER BY published_at DESC`,
    [tags]
  );
}

export async function getPublishedArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT * FROM articles WHERE status = 'published' AND slug = $1`, [slug]
  );
  return rows[0] ?? null;
}
