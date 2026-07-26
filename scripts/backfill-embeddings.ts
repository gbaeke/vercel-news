import dotenv from 'dotenv';
import { query, getPool } from '../lib/db';
import {
  articleEmbeddingText,
  createEmbeddings,
  embeddingModelId,
  vectorLiteral,
} from '../lib/embeddings';
import type { Article } from '../lib/types';

dotenv.config({ path: '.env.local' });

const BATCH_SIZE = 50;

async function main() {
  const model = embeddingModelId();
  let updated = 0;

  while (true) {
    const articles = await query<Pick<Article, 'id' | 'title' | 'summary'>>(
      `SELECT id, title, summary
       FROM articles
       WHERE status = 'published'
         AND (embedding IS NULL OR embedding_model IS DISTINCT FROM $1)
       ORDER BY id
       LIMIT $2`,
      [model, BATCH_SIZE]
    );
    if (articles.length === 0) break;

    const embeddings = await createEmbeddings(articles.map(articleEmbeddingText));
    for (let i = 0; i < articles.length; i++) {
      await query(
        `UPDATE articles
         SET embedding = $1::vector, embedding_model = $2, embedded_at = now()
         WHERE id = $3 AND status = 'published'`,
        [vectorLiteral(embeddings[i]), model, articles[i].id]
      );
      updated++;
    }
    console.log(`[embeddings] stored ${updated}`);
  }

  console.log(`[embeddings] backfill complete: ${updated} article(s) updated with ${model}`);
}

main()
  .catch((error) => {
    console.error('[embeddings] backfill failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end();
  });
