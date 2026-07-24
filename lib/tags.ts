import { query } from './db';

export const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export async function getTags(): Promise<string[]> {
  const rows = await query<{ name: string }>(`SELECT name FROM tags ORDER BY name`);
  return rows.map((r) => r.name);
}

export function normalizeTagName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return TAG_NAME_PATTERN.test(name) ? name : null;
}

export async function addTag(name: string): Promise<void> {
  await query(`INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
}

// The tagging handler needs at least one tag to build its schema, so the last
// tag cannot be deleted.
export async function deleteTag(name: string): Promise<{ deleted: boolean; reason?: string }> {
  const [{ count }] = await query<{ count: string }>(`SELECT count(*) FROM tags`);
  if (Number(count) <= 1) {
    return { deleted: false, reason: 'cannot delete the last tag — the tagging step needs at least one' };
  }
  await query(`DELETE FROM tags WHERE name = $1`, [name]);
  return { deleted: true };
}
