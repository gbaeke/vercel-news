import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { releasePendingScrapeRetries, runTick } from '../lib/tick';
import type { Handler } from '../lib/handlers/registry';

async function insertArticle(url: string, status: string) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, status) VALUES ('openai', $1, $2) RETURNING id`,
    [url, status]
  );
  return rows[0].id;
}

describe('runTick', () => {
  it('releases pending scrape retries for a manual desk run', async () => {
    const id = await insertArticle('https://example.com/retry', 'scrape_retry');
    await query(
      `UPDATE articles SET source_next_retry_at = now() + interval '10 minutes' WHERE id = $1`,
      [id]
    );

    await expect(releasePendingScrapeRetries()).resolves.toBe(1);
    const [row] = await query<{ source_next_retry_at: string }>(
      `SELECT source_next_retry_at FROM articles WHERE id = $1`, [id]
    );
    expect(new Date(row.source_next_retry_at).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('walks an article through a chain of stub handlers in one call', async () => {
    await insertArticle('https://example.com/a', 'new');

    const advance = (to: string): Handler => async (article) => {
      await query(`UPDATE articles SET status = $1, claimed_at = NULL WHERE id = $2`, [to, article.id]);
      return to;
    };

    const stubHandlers: Record<string, Handler> = {
      new: advance('scraped'),
      scraped: advance('tagged'),
      tagged: advance('written'),
      written: advance('in_review'),
    };

    const result = await runTick(stubHandlers);
    expect(result.map((r) => r.to)).toEqual(['scraped', 'tagged', 'written', 'in_review']);

    const [row] = await query<{ status: string }>(`SELECT status FROM articles`);
    expect(row.status).toBe('in_review');
  });

  it('marks a throwing handler as failed with failed_from and error set', async () => {
    const id = await insertArticle('https://example.com/b', 'new');
    const throwing: Record<string, Handler> = {
      new: async () => { throw new Error('boom'); },
    };

    await runTick(throwing);

    const [row] = await query<{ status: string; failed_from: string; error: string }>(
      `SELECT status, failed_from, error FROM articles WHERE id = $1`, [id]
    );
    expect(row.status).toBe('failed');
    expect(row.failed_from).toBe('new');
    expect(row.error).toBe('boom');
  });

  it('stops when the queue is empty', async () => {
    const result = await runTick({});
    expect(result).toEqual([]);
  });
});
