import { getPool, query } from './db';

export const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export async function getTags(): Promise<string[]> {
  const rows = await query<{ name: string }>(`SELECT name FROM tags ORDER BY name`);
  return rows.map((r) => r.name);
}

export function normalizeTagName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return TAG_NAME_PATTERN.test(name) ? name : null;
}

export async function addTag(name: string): Promise<boolean> {
  const rows = await query<{ name: string }>(
    `INSERT INTO tags (name) VALUES ($1)
     ON CONFLICT (name) DO NOTHING
     RETURNING name`,
    [name]
  );
  return rows.length > 0;
}

// The tagging handler needs at least one tag to build its schema, so the last
// tag cannot be deleted.
export type DeleteTagResult =
  | { deleted: true }
  | { deleted: false; reason: 'last_tag' | 'not_found' };

export async function deleteTag(name: string): Promise<DeleteTagResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tags = await client.query<{ name: string }>(`SELECT name FROM tags ORDER BY name FOR UPDATE`);
    if (!tags.rows.some((tag) => tag.name === name)) {
      await client.query('ROLLBACK');
      return { deleted: false, reason: 'not_found' };
    }
    if (tags.rows.length <= 1) {
      await client.query('ROLLBACK');
      return { deleted: false, reason: 'last_tag' };
    }
    await client.query(`DELETE FROM tags WHERE name = $1`, [name]);
    await client.query('COMMIT');
    return { deleted: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
