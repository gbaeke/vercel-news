import { beforeEach, afterAll } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.FAKE_LLM = '1';

import { getPool } from '../lib/db';

beforeEach(async () => {
  const pool = getPool();
  await pool.query('TRUNCATE articles, feed_state RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await getPool().end();
});
