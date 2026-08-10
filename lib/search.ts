import { unstable_cache } from 'next/cache';
import { createEmbedding, embeddingModelId } from './embeddings';
import { getPublishedArticlesByEmbedding } from './publicQueries';
import { normalizeSearchQuery } from './searchInput';
import type { Article } from './types';

export { normalizeSearchQuery } from './searchInput';

// Vercel's persistent Data Cache avoids paying for the same normalized query
// repeatedly across instances and deployments. The model id is part of the
// arguments, so changing embedding spaces cannot reuse an incompatible vector.
const cachedSearchEmbedding = unstable_cache(
  async (searchText: string, _model: string) => createEmbedding(searchText),
  ['semantic-search-embedding-v1'],
  { revalidate: 60 * 60 * 24 }
);

export async function searchPublishedArticles(
  searchText: string,
  tags: string[] = []
): Promise<Article[]> {
  const normalized = normalizeSearchQuery(searchText);
  if (!normalized) return [];

  const model = embeddingModelId();
  const embedding = await cachedSearchEmbedding(normalized, model);
  return getPublishedArticlesByEmbedding(embedding, model, tags, 10);
}
