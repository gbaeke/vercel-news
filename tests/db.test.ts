import { describe, it, expect } from 'vitest';
import { getPool, query } from '../lib/db';

describe('db', () => {
  it('contains errors emitted by idle pool clients', () => {
    expect(getPool().listenerCount('error')).toBeGreaterThan(0);
  });

  it('inserts and reads back an article', async () => {
    const rows = await query(
      `INSERT INTO articles (source_feed, trigger_url, status) VALUES ($1, $2, $3) RETURNING *`,
      ['openai', 'https://example.com/a', 'new']
    );
    expect(rows[0].status).toBe('new');
    expect(rows[0].version).toBe(1);
  });
});
