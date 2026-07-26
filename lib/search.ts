import { createEmbedding, embeddingModelId } from './embeddings';
import { getPublishedArticlesByEmbedding } from './publicQueries';
import { normalizeSearchQuery } from './searchInput';
import type { Article } from './types';

export { normalizeSearchQuery } from './searchInput';

export async function searchPublishedArticles(
  searchText: string,
  tags: string[] = []
): Promise<Article[]> {
  const normalized = normalizeSearchQuery(searchText);
  if (!normalized) return [];

  const embedding = await createEmbedding(normalized);
  return getPublishedArticlesByEmbedding(embedding, embeddingModelId(), tags, 10);
}
