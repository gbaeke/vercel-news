import { query } from './db';

export const MAX_ITEMS_PER_POLL = 2;

export const FEED_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export interface Feed {
  name: string;
  url: string;
}

export async function getFeeds(): Promise<Feed[]> {
  return query<Feed>(`SELECT name, url FROM feeds ORDER BY name`);
}

export function normalizeFeedName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return FEED_NAME_PATTERN.test(name) ? name : null;
}

export type AddFeedResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'url_conflict'; existingName: string | null };

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export async function addFeed(name: string, url: string): Promise<AddFeedResult> {
  const [previous] = await query<{ url: string }>(`SELECT url FROM feeds WHERE name = $1`, [name]);
  if (previous?.url === url) return { ok: true, changed: false };

  try {
    await query(
      `WITH upserted AS (
         INSERT INTO feeds (name, url) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET url = EXCLUDED.url
         RETURNING name
       ), cleared_cursor AS (
         DELETE FROM feed_state
         WHERE feed_name = $1 AND $3::text IS DISTINCT FROM $2
       )
       SELECT name FROM upserted`,
      [name, url, previous?.url ?? null]
    );
    return { ok: true, changed: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await query<{ name: string }>(`SELECT name FROM feeds WHERE url = $1`, [url]);
    return { ok: false, reason: 'url_conflict', existingName: existing?.name ?? null };
  }
}

// Also drop the cursor so a re-added feed starts fresh instead of resuming
// from a stale last_url.
export async function deleteFeed(name: string): Promise<boolean> {
  const [result] = await query<{ deleted: boolean }>(
    `WITH deleted_feed AS (
       DELETE FROM feeds WHERE name = $1 RETURNING name
     ), deleted_cursor AS (
       DELETE FROM feed_state WHERE feed_name = $1
     )
     SELECT EXISTS(SELECT 1 FROM deleted_feed) AS deleted`,
    [name]
  );
  return result?.deleted ?? false;
}
