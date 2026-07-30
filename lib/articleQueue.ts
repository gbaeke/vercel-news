import { query } from './db';

export interface EnqueueArticleInput {
  sourceFeed: string;
  url: string;
  title?: string | null;
  content?: string | null;
}

export type EnqueueArticleResult =
  | { outcome: 'inserted'; id: number; status: string }
  | { outcome: 'duplicate'; id: number; status: string }
  | { outcome: 'deleted' };

interface QueueRow {
  outcome: EnqueueArticleResult['outcome'];
  id: number | null;
  status: string | null;
}

/**
 * Put a discovered story into the processing queue.
 *
 * RSS ingestion and manual Desk submissions both pass through this function,
 * so duplicate URLs and URLs the operator permanently deleted behave the same
 * regardless of where they were discovered.
 */
export async function enqueueArticle(input: EnqueueArticleInput): Promise<EnqueueArticleResult> {
  const [row] = await query<QueueRow>(
    `WITH blocked AS (
       SELECT EXISTS (SELECT 1 FROM deleted_urls WHERE url = $2) AS value
     ),
     inserted AS (
       INSERT INTO articles (source_feed, trigger_url, trigger_title, trigger_content, source_rss_content, status)
       SELECT $1, $2, $3, $4, $4, 'new'
       WHERE NOT (SELECT value FROM blocked)
       ON CONFLICT (trigger_url) DO NOTHING
       RETURNING id, status
     )
     SELECT 'inserted'::text AS outcome, id, status
     FROM inserted
     UNION ALL
     SELECT 'duplicate'::text AS outcome, a.id, a.status
     FROM articles a
     WHERE a.trigger_url = $2
       AND NOT (SELECT value FROM blocked)
       AND NOT EXISTS (SELECT 1 FROM inserted)
     UNION ALL
     SELECT 'deleted'::text AS outcome, NULL::integer AS id, NULL::text AS status
     WHERE (SELECT value FROM blocked)
     LIMIT 1`,
    [input.sourceFeed, input.url, input.title ?? null, input.content ?? null]
  );

  if (!row) {
    throw new Error('Article queue did not return an outcome');
  }
  if (row.outcome === 'deleted') return { outcome: 'deleted' };
  if (row.id === null || row.status === null) {
    throw new Error('Article queue returned an incomplete outcome');
  }
  return { outcome: row.outcome, id: row.id, status: row.status };
}
