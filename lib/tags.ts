import { getPool, query } from './db';
import { findPersona } from './personas';

export const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export interface TagConfig {
  name: string;
  personaId: string;
}

interface TagRow {
  name: string;
  persona_id: string;
}

export async function getTagConfigs(): Promise<TagConfig[]> {
  const rows = await query<TagRow>(`SELECT name, persona_id FROM tags ORDER BY name`);
  return rows.map((row) => ({ name: row.name, personaId: row.persona_id }));
}

export async function getTags(): Promise<string[]> {
  return (await getTagConfigs()).map((tag) => tag.name);
}

export function normalizeTagName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return TAG_NAME_PATTERN.test(name) ? name : null;
}

function requirePersona(personaId: string): void {
  if (!findPersona(personaId)) throw new Error(`unknown persona: ${personaId}`);
}

export async function addTag(name: string, personaId: string): Promise<boolean> {
  requirePersona(personaId);
  const rows = await query<{ name: string }>(
    `INSERT INTO tags (name, persona_id) VALUES ($1, $2)
     ON CONFLICT (name) DO NOTHING
     RETURNING name`,
    [name, personaId]
  );
  return rows.length > 0;
}

export async function updateTagPersona(name: string, personaId: string): Promise<boolean> {
  requirePersona(personaId);
  const rows = await query<{ name: string }>(
    `UPDATE tags SET persona_id = $1 WHERE name = $2 RETURNING name`,
    [personaId, name]
  );
  return rows.length > 0;
}

export async function getTagPersonaId(name: string): Promise<string | null> {
  const [row] = await query<{ persona_id: string }>(
    `SELECT persona_id FROM tags WHERE name = $1`,
    [name]
  );
  return row?.persona_id ?? null;
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
