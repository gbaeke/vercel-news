import { beforeEach, afterAll } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.FAKE_LLM = '1';

import { getPool } from '../lib/db';

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    'TRUNCATE weekly_episodes, articles, feed_state, deleted_urls RESTART IDENTITY CASCADE'
  );
  // Reset tags/feeds to the seed defaults so every test starts from a known config.
  await pool.query('TRUNCATE tags, feeds');
  await pool.query(
    `INSERT INTO tags (name, persona_id) VALUES
     ('models', 'pragmatic-engineer'),
     ('tooling', 'pragmatic-engineer'),
     ('research', 'research-explainer'),
     ('product', 'pragmatic-engineer'),
     ('policy', 'policy-watcher'),
     ('industry', 'policy-watcher')`
  );
  await pool.query(
    `INSERT INTO feeds (name, url) VALUES
     ('openai', 'https://openai.com/news/rss.xml'),
     ('anthropic', 'https://www.anthropic.com/rss.xml')`
  );
});

afterAll(async () => {
  await getPool().end();
});
