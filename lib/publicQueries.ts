import { query } from './db';
import type { Article } from './types';

export async function getPublishedArticles(): Promise<Article[]> {
  return query<Article>(
    `SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC`
  );
}

export async function getPublishedArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT * FROM articles WHERE status = 'published' AND slug = $1`, [slug]
  );
  return rows[0] ?? null;
}
