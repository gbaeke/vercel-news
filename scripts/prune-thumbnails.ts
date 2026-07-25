/**
 * One-off sweep for thumbnails left behind before cleanup existed: images from
 * deleted articles, and every superseded image from a "New thumbnail" click.
 *
 * Dry run by default. Pass --yes to actually delete.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/prune-thumbnails.ts
 *   DATABASE_URL=<prod> npx tsx scripts/prune-thumbnails.ts --yes
 *
 * A blob is deleted only when no article row references it. Because the whole
 * job hinges on reading the *right* database, it refuses to run if the data
 * looks wrong rather than trusting an empty result set.
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { list, del } from '@vercel/blob';

dotenv.config({ path: '.env.local' });

const THUMBNAIL_PREFIX = 'thumbnails/';
const apply = process.argv.includes('--yes');

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set');

  // Say out loud what we are pointed at — a silent wrong-database run is the
  // one failure mode that could delete every live thumbnail.
  const pool = new Pool({ connectionString });
  const [{ db, host }] = (
    await pool.query(
      `select current_database() as db, coalesce(inet_server_addr()::text, 'local') as host`
    )
  ).rows;
  console.log(`database : ${db} @ ${host}`);
  console.log(`mode     : ${apply ? 'DELETE (--yes)' : 'dry run'}`);

  const { rows: articles } = await pool.query<{ thumbnail_url: string | null }>(
    `select thumbnail_url from articles`
  );
  const referenced = new Set(
    articles.map((a) => a.thumbnail_url).filter((u): u is string => Boolean(u))
  );
  console.log(`articles : ${articles.length} rows, ${referenced.size} distinct thumbnails referenced`);

  if (articles.length === 0) {
    throw new Error('refusing to run: no article rows — wrong database?');
  }
  if (referenced.size === 0) {
    throw new Error('refusing to run: no thumbnails referenced at all — wrong database?');
  }

  let cursor: string | undefined;
  const blobs: { url: string; pathname: string; size: number }[] = [];
  do {
    const res = await list({ cursor, limit: 1000, prefix: THUMBNAIL_PREFIX, token });
    blobs.push(...res.blobs.map((b) => ({ url: b.url, pathname: b.pathname, size: b.size })));
    cursor = res.cursor;
  } while (cursor);
  console.log(`blobs    : ${blobs.length} under ${THUMBNAIL_PREFIX}`);

  const live = blobs.filter((b) => referenced.has(b.url));
  const orphans = blobs.filter((b) => !referenced.has(b.url));

  // If not a single referenced URL appears in this store, the database and the
  // blob store belong to different environments and every blob would look like
  // an orphan. Bail out.
  if (live.length === 0) {
    throw new Error(
      'refusing to run: none of the referenced thumbnails exist in this store — database/store mismatch?'
    );
  }

  console.log(`\nkeeping ${live.length} live thumbnail(s), ${mb(live.reduce((n, b) => n + b.size, 0))}`);
  console.log(`orphans ${orphans.length}, ${mb(orphans.reduce((n, b) => n + b.size, 0))} reclaimable:`);
  for (const o of orphans) console.log(`  ${o.pathname}  ${mb(o.size)}`);

  if (!apply) {
    console.log('\ndry run — nothing deleted. Re-run with --yes to delete the orphans above.');
    await pool.end();
    return;
  }

  let deleted = 0;
  let freed = 0;
  for (const o of orphans) {
    // Re-check against the database immediately before deleting: the sweep may
    // have been running while the pipeline published a new image.
    const { rows } = await pool.query(`select 1 from articles where thumbnail_url = $1 limit 1`, [o.url]);
    if (rows.length > 0) {
      console.log(`  skipped ${o.pathname} — became referenced during the sweep`);
      continue;
    }
    await del(o.url, { token });
    deleted++;
    freed += o.size;
    console.log(`  deleted ${o.pathname}`);
  }
  console.log(`\ndeleted ${deleted} blob(s), freed ${mb(freed)}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
