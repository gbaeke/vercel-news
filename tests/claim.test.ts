import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { claimNext } from '../lib/claim';

async function insertArticle(url: string, status: string) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, status) VALUES ('openai', $1, $2) RETURNING id`,
    [url, status]
  );
  return rows[0].id;
}

describe('claimNext', () => {
  it('claims the oldest claimable row and sets claimed_at', async () => {
    await insertArticle('https://example.com/1', 'new');
    const id2 = await insertArticle('https://example.com/2', 'new');
    await query(`UPDATE articles SET updated_at = now() - interval '1 hour' WHERE id != $1`, [id2]);

    const claimed = await claimNext();
    expect(claimed?.id).not.toBe(id2); // the older row (not id2) claims first
    expect(claimed?.claimed_at).not.toBeNull();
  });

  it('ignores rows with a status that has no handler mapping (in_review etc.)', async () => {
    await insertArticle('https://example.com/3', 'in_review');
    const claimed = await claimNext();
    expect(claimed).toBeNull();
  });

  it('re-claims a row whose claimed_at is stale (>10 minutes)', async () => {
    const id = await insertArticle('https://example.com/4', 'new');
    await query(`UPDATE articles SET claimed_at = now() - interval '11 minutes' WHERE id = $1`, [id]);
    const claimed = await claimNext();
    expect(claimed?.id).toBe(id);
  });

  it('does not claim a row whose claimed_at is fresh', async () => {
    await insertArticle('https://example.com/5', 'new');
    await query(`UPDATE articles SET claimed_at = now() WHERE trigger_url = 'https://example.com/5'`);
    const claimed = await claimNext();
    expect(claimed).toBeNull();
  });

  it('two concurrent claims never grab the same row', async () => {
    await insertArticle('https://example.com/6', 'new');
    await insertArticle('https://example.com/7', 'new');
    const [a, b] = await Promise.all([claimNext(), claimNext()]);
    expect(a?.id).not.toBeNull();
    expect(b?.id).not.toBeNull();
    expect(a?.id).not.toBe(b?.id);
  });
});
