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

export async function addFeed(name: string, url: string): Promise<void> {
  await query(
    `INSERT INTO feeds (name, url) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET url = EXCLUDED.url`,
    [name, url]
  );
}

// Also drop the cursor so a re-added feed starts fresh instead of resuming
// from a stale last_url.
export async function deleteFeed(name: string): Promise<void> {
  await query(`DELETE FROM feeds WHERE name = $1`, [name]);
  await query(`DELETE FROM feed_state WHERE feed_name = $1`, [name]);
}
