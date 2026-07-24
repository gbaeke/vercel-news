import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: '.env.local' });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString });
  const sql = fs.readFileSync(path.join(process.cwd(), 'lib', 'schema.sql'), 'utf-8');
  await pool.query(sql);
  await pool.end();
  console.log('migration applied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
