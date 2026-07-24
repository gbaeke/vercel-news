import { query } from './db';
import { HANDLERS } from './handlers/registry';
import type { Article } from './types';

// A status is claimable exactly when a handler exists for it — the registry
// is the single source of truth, so the two can never drift apart.
const CLAIMABLE_STATUSES = Object.keys(HANDLERS);

export async function claimNext(): Promise<Article | null> {
  const rows = await query<Article>(
    `UPDATE articles SET claimed_at = now()
     WHERE id = (
       SELECT id FROM articles
       WHERE status = ANY($1)
         AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
       ORDER BY updated_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [CLAIMABLE_STATUSES]
  );
  return rows[0] ?? null;
}
