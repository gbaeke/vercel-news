import type { BlobCleanupDeps } from './blobCleanup';
import { query } from './db';
import { deleteArticleById } from './reviewActions';

export interface DeclinedCleanupResult {
  deleted: number;
}

// Delete declined stories through the same permanent-delete path as the review
// desk. That tombstones the source URL and removes an orphaned thumbnail.
export async function cleanupDeclinedArticles(
  deps: BlobCleanupDeps = {}
): Promise<DeclinedCleanupResult> {
  const articles = await query<{ id: number }>(
    `SELECT id
     FROM articles
     WHERE status = 'declined'
     ORDER BY id`
  );

  let deleted = 0;
  for (const article of articles) {
    const result = await deleteArticleById(article.id, deps);
    if (result.ok) deleted += 1;
  }

  return { deleted };
}
