# Personal AI Newsroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the zero-infra-cost personal AI newsroom described in `spec/spec.md` — an RSS-fed, LLM-written, human-reviewed article pipeline running as a single Next.js app on Vercel Hobby + Neon + Vercel Blob.

**Architecture:** A single Postgres `articles` table stores every article's pipeline position as a `status` column (a state machine). A stateless `/api/tick` route claims one row at a time (`FOR UPDATE SKIP LOCKED`), runs the handler registered for that status, and loops until a time budget or an empty queue. No queue, no daemon — an external scheduler (GitHub Actions or cron-job.org) is the only thing that makes time pass. A password-gated `/review` UI is the only way a row crosses from `in_review` into `approved`; publishing itself is just another tick handler.

**Tech Stack:** Next.js 14 (App Router, TypeScript, Node.js runtime — not Edge, because Postgres access needs a TCP socket), `pg` (not `@neondatabase/serverless` — see constraint below), `rss-parser`, `@extractus/article-extractor`, `marked` + `sanitize-html`, `js-yaml`, `@vercel/blob`, `openai`, Vitest, `tsx`.

## Global Constraints

- **Platform limits (verified July 2026):** Vercel Hobby function duration is 300s with Fluid compute enabled — tick budget must stay under this (`TICK_BUDGET_MS` default `240000`). Vercel Hobby cron runs **at most once/day** with imprecise timing — it is a backstop only, never the primary trigger. Neon free tier: 0.5 GB storage/project, autosuspends after ~5 min idle, connections must go through the pooled endpoint. Vercel Blob Hobby tier: 1 GB storage / 10 GB transfer per month — images go in Blob, never in Postgres.
- **DB driver choice:** use `pg`, not `@neondatabase/serverless`. Neon's pooled connection string is a standard libpq connection string, so plain `pg` works against it unmodified — and also works unmodified against a local Docker Postgres for tests. `@neondatabase/serverless`'s WebSocket transport requires a proxy shim to reach non-Neon hosts, which would complicate every test in this plan for no benefit at this scale.
- **One UPDATE per transition.** Every handler writes its outputs and its new status in a single SQL statement, and must be safe to re-run (a crash before that UPDATE commits just means the row re-claims at its previous status on the next tick).
- **Failures are data, not exceptions that escape.** A handler may throw; the tick loop (not the handler) is what catches it and sets `status='failed', failed_from=<status the handler started at>, error=<message>`.
- **Auth:** `/api/tick` and `/api/ingest` require header `Authorization: Bearer ${CRON_SECRET}` — reject anything else with 401. `/review/*` requires an httpOnly cookie set by comparing a posted password to `REVIEW_PASSWORD` (single shared password, no user accounts).
- **`FAKE_LLM=1` must fully replace the LLM module with deterministic, zero-network-call output.** The whole pipeline (ingest → in_review) must be exercisable in tests and locally for $0.
- **Prompts are content, not code.** Every system/user prompt lives in `prompts/*.md` with `{{ placeholder }}` substitution — no inline prompt strings in handler code.
- **Backfill guard:** ingestion takes at most `MAX_ITEMS_PER_POLL` (default **2**) new items per feed per poll, newest-first, stopping at the last-seen URL.
- **A missing thumbnail must never block publication** — image failures fall back to a deterministic placeholder, never `failed`.
- **Images live in Vercel Blob, never in Postgres.**

---

## Task 1: Project scaffold, tooling, and Postgres test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.env.example`, `.gitignore`
- Create: `docker-compose.test.yml`
- Create: `tests/setup.ts`
- Create: `scripts/migrate.ts`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Produces: `npm run dev`, `npm test`, `npm run db:migrate` scripts; `tests/setup.ts` truncates all tables before each test via a global Vitest `beforeEach`.

- [ ] **Step 1: Initialize the Next.js + TypeScript project**

```bash
mkdir -p /Users/geertbaeke/projects/vercel-news
cd /Users/geertbaeke/projects/vercel-news
npm init -y
npm install next@^14 react@^18 react-dom@^18
npm install pg rss-parser @extractus/article-extractor marked sanitize-html js-yaml @vercel/blob openai
npm install -D typescript @types/node @types/react @types/pg @types/sanitize-html @types/js-yaml vitest tsx dotenv
```

- [ ] **Step 2: Write `package.json` scripts**

```json
{
  "name": "vercel-news",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:test:up": "docker compose -f docker-compose.test.yml up -d && sleep 2 && DATABASE_URL=$TEST_DATABASE_URL tsx scripts/migrate.ts"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write `next.config.mjs`**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 5: Write `.env.example`**

```
DATABASE_URL=
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_test
OPENAI_API_KEY=
TEXT_MODEL=gpt-4o-mini
IMAGE_MODEL=gpt-image-1
CRON_SECRET=
REVIEW_PASSWORD=
BLOB_READ_WRITE_TOKEN=
FAKE_LLM=0
TICK_BUDGET_MS=240000
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
.next
.env
.env.local
```

- [ ] **Step 7: Write `docker-compose.test.yml` (local Postgres for tests)**

```yaml
services:
  test-db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: vercel_news_test
    ports:
      - "5433:5432"
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
```

- [ ] **Step 9: Write `tests/setup.ts`**

```ts
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
```

- [ ] **Step 10: Write `.env.test`**

```
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_test
```

- [ ] **Step 11: Write the sanity test**

```ts
// tests/sanity.test.ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 12: Bring up the test DB and run the sanity test**

Run: `docker compose -f docker-compose.test.yml up -d && npm test`
Expected: fails with "Cannot find module '../lib/db'" (not written yet) — confirms the harness wiring is live. Note this is expected; Task 2 creates `lib/db.ts`.

- [ ] **Step 13: Commit**

```bash
git init
git add package.json tsconfig.json next.config.mjs vitest.config.ts .env.example .gitignore docker-compose.test.yml tests/setup.ts tests/sanity.test.ts .env.test
git commit -m "chore: project scaffold and Postgres test harness"
```

---

## Task 2: Database schema, migration script, and DB client

**Files:**
- Create: `lib/schema.sql`
- Create: `lib/db.ts`
- Create: `lib/types.ts`
- Create: `scripts/migrate.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `getPool()` from `tests/setup.ts` (Task 1).
- Produces: `query<T>(text: string, params?: any[]): Promise<T[]>`, `getPool(): Pool` from `lib/db.ts`; `Article` and `FeedState` interfaces from `lib/types.ts`, used by every later task.

- [ ] **Step 1: Write `lib/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS articles (
  id             SERIAL PRIMARY KEY,
  source_feed    TEXT NOT NULL,
  trigger_url    TEXT NOT NULL UNIQUE,
  trigger_title  TEXT,
  trigger_content TEXT,
  tags           JSONB,
  persona        TEXT,
  title          TEXT,
  content_md     TEXT,
  content_html   TEXT,
  summary        TEXT,
  seo_summary    TEXT,
  slug           TEXT UNIQUE,
  thumbnail_url  TEXT,
  feedback       TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'new',
  failed_from    TEXT,
  error          TEXT,
  claimed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS articles_status_idx ON articles (status, updated_at);

CREATE TABLE IF NOT EXISTS feed_state (
  feed_name  TEXT PRIMARY KEY,
  last_url   TEXT
);
```

- [ ] **Step 2: Write `lib/types.ts`**

```ts
export interface Article {
  id: number;
  source_feed: string;
  trigger_url: string;
  trigger_title: string | null;
  trigger_content: string | null;
  tags: { primary: string; secondary: string[] } | null;
  persona: string | null;
  title: string | null;
  content_md: string | null;
  content_html: string | null;
  summary: string | null;
  seo_summary: string | null;
  slug: string | null;
  thumbnail_url: string | null;
  feedback: string | null;
  version: number;
  status: string;
  failed_from: string | null;
  error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface FeedState {
  feed_name: string;
  last_url: string | null;
}
```

- [ ] **Step 3: Write `lib/db.ts`**

```ts
import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}
```

- [ ] **Step 4: Write `scripts/migrate.ts`**

```ts
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
```

- [ ] **Step 5: Write the failing test**

```ts
// tests/db.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';

describe('db', () => {
  it('inserts and reads back an article', async () => {
    const rows = await query(
      `INSERT INTO articles (source_feed, trigger_url, status) VALUES ($1, $2, $3) RETURNING *`,
      ['openai', 'https://example.com/a', 'new']
    );
    expect(rows[0].status).toBe('new');
    expect(rows[0].version).toBe(1);
  });
});
```

- [ ] **Step 6: Apply the schema to the test DB and run the test**

Run: `DATABASE_URL=$TEST_DATABASE_URL npx tsx scripts/migrate.ts && npm test -- tests/db.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/schema.sql lib/db.ts lib/types.ts scripts/migrate.ts tests/db.test.ts
git commit -m "feat: database schema, migration script, and pg client"
```

---

## Task 3: Claim query and the tick loop skeleton

**Files:**
- Create: `lib/claim.ts`
- Create: `lib/handlers/registry.ts`
- Create: `lib/tick.ts`
- Test: `tests/claim.test.ts`
- Test: `tests/tick.test.ts`

**Interfaces:**
- Consumes: `query`, `Article` (Task 2).
- Produces: `claimNext(): Promise<Article | null>` from `lib/claim.ts`; `Handler = (article: Article) => Promise<string>` type and `HANDLERS: Record<string, Handler>` (starts empty, populated by later tasks) from `lib/handlers/registry.ts`; `runTick(handlers?: Record<string, Handler>, budgetMs?: number): Promise<{id:number; from:string; to:string}[]>` from `lib/tick.ts` — every later task that adds a handler edits `registry.ts` to register it.

- [ ] **Step 1: Write `lib/claim.ts`**

```ts
import { query } from './db';
import type { Article } from './types';

const CLAIMABLE_STATUSES = [
  'new', 'scraped', 'tagged', 'written',
  'rewrite_requested', 'image_requested', 'approved',
];

export async function claimNext(): Promise<Article | null> {
  const rows = await query<Article>(
    `UPDATE articles SET claimed_at = now()
     WHERE id = (
       SELECT id FROM articles
       WHERE status = ANY($1)
         AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
       ORDER BY updated_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [CLAIMABLE_STATUSES]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Write the claim test**

```ts
// tests/claim.test.ts
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
```

- [ ] **Step 3: Run the claim tests to verify they fail**

Run: `npm test -- tests/claim.test.ts`
Expected: FAIL (file exists, but this confirms the suite executes before moving on — if `lib/claim.ts` has a bug this catches it now)

- [ ] **Step 4: Run again after Step 1's implementation**

Run: `npm test -- tests/claim.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write `lib/handlers/registry.ts`**

```ts
import type { Article } from '../types';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {};
```

- [ ] **Step 6: Write `lib/tick.ts`**

```ts
import { claimNext } from './claim';
import { query } from './db';
import { HANDLERS, type Handler } from './handlers/registry';

const DEFAULT_BUDGET_MS = 240_000;

export interface TickResult {
  id: number;
  from: string;
  to: string;
}

export async function runTick(
  handlers: Record<string, Handler> = HANDLERS,
  budgetMs: number = Number(process.env.TICK_BUDGET_MS ?? DEFAULT_BUDGET_MS)
): Promise<TickResult[]> {
  const deadline = Date.now() + budgetMs;
  const processed: TickResult[] = [];

  while (Date.now() < deadline) {
    const article = await claimNext();
    if (!article) break;

    const handler = handlers[article.status];
    if (!handler) {
      await query(`UPDATE articles SET claimed_at = NULL WHERE id = $1`, [article.id]);
      break;
    }

    try {
      const to = await handler(article);
      console.log(`[tick] article ${article.id}: ${article.status} -> ${to}`);
      processed.push({ id: article.id, from: article.status, to });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE articles SET status = 'failed', failed_from = $1, error = $2, claimed_at = NULL WHERE id = $3`,
        [article.status, message, article.id]
      );
      console.log(`[tick] article ${article.id}: ${article.status} -> failed (${message})`);
      processed.push({ id: article.id, from: article.status, to: 'failed' });
    }
  }

  return processed;
}
```

- [ ] **Step 7: Write the tick loop test**

```ts
// tests/tick.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { runTick } from '../lib/tick';
import type { Handler } from '../lib/handlers/registry';

async function insertArticle(url: string, status: string) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, status) VALUES ('openai', $1, $2) RETURNING id`,
    [url, status]
  );
  return rows[0].id;
}

describe('runTick', () => {
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
```

- [ ] **Step 8: Run the tick tests**

Run: `npm test -- tests/tick.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add lib/claim.ts lib/handlers/registry.ts lib/tick.ts tests/claim.test.ts tests/tick.test.ts
git commit -m "feat: concurrency-safe claim query and tick loop skeleton"
```

---

## Task 4: Feed config and ingestion (RSS, dedupe, backfill guard)

**Files:**
- Create: `lib/feeds.ts`
- Create: `lib/ingest.ts`
- Test: `tests/ingest.test.ts`

**Interfaces:**
- Consumes: `query` (Task 2).
- Produces: `FEEDS: { name: string; url: string }[]` from `lib/feeds.ts`; `ingestFeeds(deps?: { fetchFeedXml?: (url: string) => Promise<string> }): Promise<void>` from `lib/ingest.ts`, called by the ingest route in Task 12.

- [ ] **Step 1: Write `lib/feeds.ts`**

```ts
export const FEEDS = [
  { name: 'openai', url: 'https://openai.com/news/rss.xml' },
  { name: 'anthropic', url: 'https://www.anthropic.com/rss.xml' },
];

export const MAX_ITEMS_PER_POLL = 2;
```

- [ ] **Step 2: Write the failing ingest test**

```ts
// tests/ingest.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';

function rss(items: { title: string; link: string; description: string }[]) {
  const entries = items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

describe('ingestFeeds', () => {
  it('inserts at most MAX_ITEMS_PER_POLL newest items as status=new', async () => {
    const xml = rss([
      { title: 'Newest', link: 'https://example.com/3', description: 'd3' },
      { title: 'Middle', link: 'https://example.com/2', description: 'd2' },
      { title: 'Oldest', link: 'https://example.com/1', description: 'd1' },
    ]);

    await ingestFeeds({ fetchFeedXml: async () => xml });

    const rows = await query<{ trigger_url: string; status: string }>(
      `SELECT trigger_url, status FROM articles ORDER BY trigger_url`
    );
    expect(rows.map((r) => r.trigger_url)).toEqual(['https://example.com/2', 'https://example.com/3']);
    expect(rows.every((r) => r.status === 'new')).toBe(true);
  });

  it('stops at the last-seen URL and does not re-insert on a second poll', async () => {
    const xml = rss([
      { title: 'Newest', link: 'https://example.com/3', description: 'd3' },
      { title: 'Middle', link: 'https://example.com/2', description: 'd2' },
    ]);
    await ingestFeeds({ fetchFeedXml: async () => xml });
    await ingestFeeds({ fetchFeedXml: async () => xml });

    const rows = await query(`SELECT trigger_url FROM articles`);
    expect(rows.length).toBe(2);
  });

  it('is a no-op backfill guard against a large historical feed (only 2 land, not 200)', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      title: `Item ${i}`,
      link: `https://example.com/hist-${i}`,
      description: 'd',
    }));
    await ingestFeeds({ fetchFeedXml: async () => rss(items) });

    const rows = await query(`SELECT trigger_url FROM articles`);
    expect(rows.length).toBe(2);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/ingest.test.ts`
Expected: FAIL — `lib/ingest.ts` does not exist yet

- [ ] **Step 4: Write `lib/ingest.ts`**

```ts
import Parser from 'rss-parser';
import { query } from './db';
import { FEEDS, MAX_ITEMS_PER_POLL } from './feeds';

export interface IngestDeps {
  fetchFeedXml?: (url: string) => Promise<string>;
}

async function defaultFetchFeedXml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PersonalNewsroom/1.0)' } });
  return res.text();
}

export async function ingestFeeds(deps: IngestDeps = {}): Promise<void> {
  const fetchFeedXml = deps.fetchFeedXml ?? defaultFetchFeedXml;
  const parser = new Parser();

  for (const feed of FEEDS) {
    const [state] = await query<{ last_url: string | null }>(
      `SELECT last_url FROM feed_state WHERE feed_name = $1`,
      [feed.name]
    );
    const lastUrl = state?.last_url ?? null;

    let xml: string;
    try {
      xml = await fetchFeedXml(feed.url);
    } catch (err) {
      console.log(`[ingest] ${feed.name}: fetch failed (${(err as Error).message})`);
      continue;
    }

    const parsed = await parser.parseString(xml);
    const items = parsed.items ?? [];

    const fresh: typeof items = [];
    for (const item of items) {
      if (item.link && item.link === lastUrl) break;
      fresh.push(item);
    }

    const toInsert = fresh.slice(0, MAX_ITEMS_PER_POLL);

    for (const item of toInsert.slice().reverse()) {
      if (!item.link) continue;
      await query(
        `INSERT INTO articles (source_feed, trigger_url, trigger_title, trigger_content, status)
         VALUES ($1, $2, $3, $4, 'new')
         ON CONFLICT (trigger_url) DO NOTHING`,
        [feed.name, item.link, item.title ?? null, item.contentSnippet ?? item.content ?? null]
      );
    }

    const newest = items[0]?.link;
    if (newest) {
      await query(
        `INSERT INTO feed_state (feed_name, last_url) VALUES ($1, $2)
         ON CONFLICT (feed_name) DO UPDATE SET last_url = EXCLUDED.last_url`,
        [feed.name, newest]
      );
    }

    console.log(`[ingest] ${feed.name}: ${toInsert.length} new item(s)`);
  }
}
```

- [ ] **Step 5: Run the ingest tests**

Run: `npm test -- tests/ingest.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/feeds.ts lib/ingest.ts tests/ingest.test.ts
git commit -m "feat: RSS ingestion with dedupe and backfill guard"
```

---

## Task 5: Scrape handler (fallback chain)

**Files:**
- Create: `lib/handlers/scrape.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.new`)
- Test: `tests/handlers/scrape.test.ts`

**Interfaces:**
- Consumes: `Article`, `query`, `Handler` (Tasks 2–3).
- Produces: `scrapeHandler(article: Article, deps?: { extract?: (url: string) => Promise<string | null> }): Promise<string>` — registered at `HANDLERS.new`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/handlers/scrape.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../../lib/db';
import { scrapeHandler } from '../../lib/handlers/scrape';

async function insertArticle(overrides: Partial<{ trigger_content: string }> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, status)
     VALUES ('openai', 'https://example.com/x', $1, 'new') RETURNING *`,
    [overrides.trigger_content ?? null]
  );
  return rows[0];
}

describe('scrapeHandler', () => {
  it('stores extracted content and returns scraped when extraction succeeds', async () => {
    const article = await insertArticle();
    const longText = 'A'.repeat(500);
    const to = await scrapeHandler(article as any, { extract: async () => longText });
    expect(to).toBe('scraped');

    const [row] = await query<{ status: string; trigger_content: string }>(
      `SELECT status, trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('scraped');
    expect(row.trigger_content).toBe(longText);
  });

  it('falls back to the RSS body when extraction yields under 200 chars', async () => {
    const article = await insertArticle({ trigger_content: 'B'.repeat(300) });
    const to = await scrapeHandler(article as any, { extract: async () => 'too short' });
    expect(to).toBe('scraped');

    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content).toBe('B'.repeat(300));
  });

  it('throws when both extraction and RSS fallback yield nothing usable', async () => {
    const article = await insertArticle({ trigger_content: null });
    await expect(scrapeHandler(article as any, { extract: async () => null })).rejects.toThrow();
  });

  it('caps stored text at ~30 kB', async () => {
    const article = await insertArticle();
    const huge = 'C'.repeat(40_000);
    await scrapeHandler(article as any, { extract: async () => huge });
    const [row] = await query<{ trigger_content: string }>(
      `SELECT trigger_content FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.trigger_content.length).toBeLessThanOrEqual(30_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/handlers/scrape.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write `lib/handlers/scrape.ts`**

```ts
import { extractFromHtml } from '@extractus/article-extractor';
import { query } from '../db';
import type { Article } from '../types';

const MIN_USABLE_LENGTH = 200;
const MAX_STORED_LENGTH = 30_000;

export interface ScrapeDeps {
  extract?: (url: string) => Promise<string | null>;
}

async function defaultExtract(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const html = await res.text();
  const article = await extractFromHtml(html, url);
  return article?.content ?? null;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function scrapeHandler(article: Article, deps: ScrapeDeps = {}): Promise<string> {
  const extract = deps.extract ?? defaultExtract;

  let content: string | null = null;
  let layer = 'none';

  try {
    const extracted = await extract(article.trigger_url);
    if (extracted && collapseWhitespace(extracted).length >= MIN_USABLE_LENGTH) {
      content = collapseWhitespace(extracted);
      layer = 'fetch+extract';
    }
  } catch (err) {
    console.log(`[scrape] article ${article.id}: fetch+extract failed (${(err as Error).message})`);
  }

  if (!content && article.trigger_content && collapseWhitespace(article.trigger_content).length >= MIN_USABLE_LENGTH) {
    content = collapseWhitespace(article.trigger_content);
    layer = 'rss-body-fallback';
  }

  if (!content) {
    throw new Error('scrape failed: no usable content from fetch+extract or RSS body fallback');
  }

  console.log(`[scrape] article ${article.id}: succeeded via ${layer}`);

  const capped = content.slice(0, MAX_STORED_LENGTH);
  await query(
    `UPDATE articles SET trigger_content = $1, status = 'scraped', claimed_at = NULL WHERE id = $2`,
    [capped, article.id]
  );
  return 'scraped';
}
```

- [ ] **Step 4: Run the scrape tests**

Run: `npm test -- tests/handlers/scrape.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Register the handler**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
};
```

- [ ] **Step 6: Commit**

```bash
git add lib/handlers/scrape.ts lib/handlers/registry.ts tests/handlers/scrape.test.ts
git commit -m "feat: scrape handler with fetch/extract -> RSS fallback -> fail chain"
```

---

## Task 6: LLM module with FAKE_LLM mode, and prompt loader

**Files:**
- Create: `lib/llm.ts`
- Create: `lib/prompts.ts`
- Create: `prompts/tag-system.md`, `prompts/tag-user.md`
- Test: `tests/llm.test.ts`, `tests/prompts.test.ts`

**Interfaces:**
- Produces: `complete(system: string, user: string): Promise<string>`, `structured<T>(system: string, user: string, schema: object): Promise<T>` from `lib/llm.ts`; `loadPrompt(name: string, vars?: Record<string,string>): string` from `lib/prompts.ts`. Used by every LLM-calling handler from Task 7 onward.

- [ ] **Step 1: Write the failing prompts test**

```ts
// tests/prompts.test.ts
import { describe, it, expect } from 'vitest';
import { loadPrompt } from '../lib/prompts';

describe('loadPrompt', () => {
  it('substitutes {{ placeholder }} tokens', () => {
    const text = loadPrompt('tag-user', { content: 'hello world' });
    expect(text).toContain('hello world');
    expect(text).not.toContain('{{ content }}');
  });
});
```

- [ ] **Step 2: Write `prompts/tag-system.md`**

```markdown
You are a news triage assistant for an AI-industry newsroom. Given the text of
an article, decide whether it is genuinely AI-industry news (models, tooling,
research, product launches, policy, or industry moves) and assign one primary
tag plus up to three secondary tags from the allowed list you are given.
Respond only via the provided JSON schema.
```

- [ ] **Step 3: Write `prompts/tag-user.md`**

```markdown
Source article text:

{{ content }}
```

- [ ] **Step 4: Write `lib/prompts.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';

export function loadPrompt(name: string, vars: Record<string, string> = {}): string {
  const filePath = path.join(process.cwd(), 'prompts', `${name}.md`);
  let text = fs.readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(vars)) {
    text = text.split(`{{ ${key} }}`).join(value);
  }
  return text;
}
```

- [ ] **Step 5: Run the prompts test**

Run: `npm test -- tests/prompts.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing LLM test**

```ts
// tests/llm.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { complete, structured } from '../lib/llm';

describe('llm module (FAKE_LLM=1)', () => {
  beforeEach(() => {
    process.env.FAKE_LLM = '1';
  });

  it('complete() returns deterministic text with no network call', async () => {
    const a = await complete('system prompt', 'user prompt');
    const b = await complete('system prompt', 'user prompt');
    expect(a).toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });

  it('structured() returns an object matching the schema shape', async () => {
    const schema = {
      type: 'object',
      properties: {
        relevant: { type: 'boolean' },
        primary: { type: 'string' },
        secondary: { type: 'array', items: { type: 'string' } },
      },
      required: ['relevant', 'primary', 'secondary'],
    };
    const result = await structured<{ relevant: boolean; primary: string; secondary: string[] }>(
      'system', 'user', schema
    );
    expect(typeof result.relevant).toBe('boolean');
    expect(typeof result.primary).toBe('string');
    expect(Array.isArray(result.secondary)).toBe(true);
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npm test -- tests/llm.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 8: Write `lib/llm.ts`**

```ts
import OpenAI from 'openai';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

function isFake(): boolean {
  return process.env.FAKE_LLM === '1';
}

export async function complete(system: string, user: string): Promise<string> {
  if (isFake()) {
    return `[FAKE] response to a ${user.length}-character prompt under system: ${system.slice(0, 40)}`;
  }
  const res = await getClient().chat.completions.create({
    model: process.env.TEXT_MODEL ?? 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return res.choices[0].message.content ?? '';
}

function fakeValueForSchema(schema: any): any {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'boolean':
      return true;
    case 'integer':
    case 'number':
      return 1;
    case 'array':
      return [];
    case 'object': {
      const obj: Record<string, any> = {};
      for (const key of Object.keys(schema.properties ?? {})) {
        obj[key] = fakeValueForSchema(schema.properties[key]);
      }
      return obj;
    }
    default:
      return 'fake';
  }
}

export async function structured<T>(system: string, user: string, schema: object): Promise<T> {
  if (isFake()) {
    return fakeValueForSchema(schema) as T;
  }
  const res = await getClient().chat.completions.create({
    model: process.env.TEXT_MODEL ?? 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'response', schema, strict: true } },
  });
  return JSON.parse(res.choices[0].message.content ?? '{}') as T;
}
```

- [ ] **Step 9: Run the LLM tests**

Run: `npm test -- tests/llm.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 10: Commit**

```bash
git add lib/llm.ts lib/prompts.ts prompts/tag-system.md prompts/tag-user.md tests/llm.test.ts tests/prompts.test.ts
git commit -m "feat: LLM module with FAKE_LLM mode and file-based prompt loader"
```

---

## Task 7: Tagging handler (relevance filter + tags)

**Files:**
- Create: `lib/config.ts`
- Create: `lib/handlers/tag.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.scraped`)
- Test: `tests/handlers/tag.test.ts`

**Interfaces:**
- Consumes: `structured`, `loadPrompt` (Task 6).
- Produces: `TAGS: string[]` from `lib/config.ts`; `tagHandler(article: Article): Promise<string>` registered at `HANDLERS.scraped`. Tests mock `../../lib/llm` directly (not FAKE_LLM) so both the relevant and not-relevant branches are exercised deterministically.

- [ ] **Step 1: Write `lib/config.ts`**

```ts
export const TAGS = ['models', 'tooling', 'research', 'product', 'policy', 'industry'];
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/handlers/tag.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  structured: vi.fn(),
}));

import { structured } from '../../lib/llm';
import { tagHandler } from '../../lib/handlers/tag';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, status)
     VALUES ('openai', 'https://example.com/y', 'some scraped text', 'scraped') RETURNING *`
  );
  return rows[0];
}

describe('tagHandler', () => {
  it('stores tags and moves to tagged when relevant', async () => {
    (structured as any).mockResolvedValue({ relevant: true, primary: 'models', secondary: ['research'] });
    const article = await insertArticle();

    const to = await tagHandler(article as any);
    expect(to).toBe('tagged');

    const [row] = await query<{ status: string; tags: any }>(
      `SELECT status, tags FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('tagged');
    expect(row.tags).toEqual({ primary: 'models', secondary: ['research'] });
  });

  it('declines automatically when the LLM says not relevant', async () => {
    (structured as any).mockResolvedValue({ relevant: false, primary: 'industry', secondary: [] });
    const article = await insertArticle();

    const to = await tagHandler(article as any);
    expect(to).toBe('declined');

    const [row] = await query<{ status: string; error: string }>(
      `SELECT status, error FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.status).toBe('declined');
    expect(row.error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/handlers/tag.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Write `lib/handlers/tag.ts`**

```ts
import { query } from '../db';
import { structured } from '../llm';
import { loadPrompt } from '../prompts';
import { TAGS } from '../config';
import type { Article } from '../types';

interface TagResult {
  relevant: boolean;
  primary: string;
  secondary: string[];
}

const TAG_SCHEMA = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    primary: { type: 'string', enum: TAGS },
    secondary: { type: 'array', items: { type: 'string', enum: TAGS }, maxItems: 3 },
  },
  required: ['relevant', 'primary', 'secondary'],
  additionalProperties: false,
};

export async function tagHandler(article: Article): Promise<string> {
  const system = loadPrompt('tag-system');
  const user = loadPrompt('tag-user', { content: article.trigger_content ?? '' });
  const result = await structured<TagResult>(system, user, TAG_SCHEMA);

  if (!result.relevant) {
    await query(
      `UPDATE articles SET status = 'declined', error = $1, claimed_at = NULL WHERE id = $2`,
      ['auto-declined: not AI-industry news', article.id]
    );
    return 'declined';
  }

  await query(
    `UPDATE articles SET tags = $1, status = 'tagged', claimed_at = NULL WHERE id = $2`,
    [JSON.stringify({ primary: result.primary, secondary: result.secondary }), article.id]
  );
  return 'tagged';
}
```

- [ ] **Step 5: Run the tag tests**

Run: `npm test -- tests/handlers/tag.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Register the handler**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
};
```

- [ ] **Step 7: Commit**

```bash
git add lib/config.ts lib/handlers/tag.ts lib/handlers/registry.ts tests/handlers/tag.test.ts
git commit -m "feat: tagging handler with automatic relevance filter"
```

---

## Task 8: Personas, slug generation, and the writing chain

**Files:**
- Create: `personas.yaml`
- Create: `lib/personas.ts`
- Create: `lib/slug.ts`
- Create: `lib/markdown.ts`
- Create: `prompts/draft-system.md`, `prompts/draft-user.md`, `prompts/humanize-system.md`, `prompts/humanize-user.md`, `prompts/finish-system.md`, `prompts/finish-user.md`
- Create: `lib/handlers/write.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.tagged`)
- Test: `tests/slug.test.ts`, `tests/personas.test.ts`, `tests/handlers/write.test.ts`

**Interfaces:**
- Consumes: `complete`, `structured`, `loadPrompt` (Task 6), `TAGS` (Task 7).
- Produces: `pickPersona(primaryTag: string): Persona` from `lib/personas.ts`; `generateSlug(title: string, slugExists: (slug: string) => Promise<boolean>): Promise<string>` from `lib/slug.ts`; `renderMarkdown(md: string): string` from `lib/markdown.ts`; `writeHandler(article: Article): Promise<string>` registered at `HANDLERS.tagged`.

- [ ] **Step 1: Write `personas.yaml`**

```yaml
personas:
  - name: pragmatic-engineer
    style: >
      Pragmatic engineer, dry wit, focuses on day-to-day workflow impact —
      what this actually changes for someone shipping code tomorrow.
    tags: [tooling, product, models]
  - name: policy-watcher
    style: >
      Measured policy analyst voice, connects the news to regulation and
      industry incentives without editorializing.
    tags: [policy, industry]
  - name: research-explainer
    style: >
      Patient explainer voice, unpacks technical claims for a practitioner
      audience without dumbing them down.
    tags: [research]
```

- [ ] **Step 2: Write `lib/personas.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'js-yaml';

export interface Persona {
  name: string;
  style: string;
  tags: string[];
}

let cache: Persona[] | null = null;

function loadPersonas(): Persona[] {
  if (!cache) {
    const raw = fs.readFileSync(path.join(process.cwd(), 'personas.yaml'), 'utf-8');
    const parsed = YAML.load(raw) as { personas: Persona[] };
    cache = parsed.personas;
  }
  return cache;
}

export function pickPersona(primaryTag: string): Persona {
  const personas = loadPersonas();
  const match = personas.find((p) => p.tags.includes(primaryTag));
  return match ?? personas[0];
}
```

- [ ] **Step 3: Write `tests/personas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pickPersona } from '../lib/personas';

describe('pickPersona', () => {
  it('picks a persona whose tags include the primary tag', () => {
    const persona = pickPersona('policy');
    expect(persona.tags).toContain('policy');
  });

  it('falls back to the first persona for an unmatched tag', () => {
    const persona = pickPersona('nonexistent-tag');
    expect(persona.name).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run the personas test**

Run: `npm test -- tests/personas.test.ts`
Expected: PASS

- [ ] **Step 5: Write `lib/slug.ts`**

```ts
function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function generateSlug(
  title: string,
  slugExists: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = slugify(title) || 'article';
  let candidate = base;
  let suffix = 1;
  while (await slugExists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
```

- [ ] **Step 6: Write `tests/slug.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateSlug } from '../lib/slug';

describe('generateSlug', () => {
  it('slugifies a title', async () => {
    const slug = await generateSlug('Hello, World! New Model', async () => false);
    expect(slug).toBe('hello-world-new-model');
  });

  it('appends a numeric suffix on collision', async () => {
    const taken = new Set(['hello-world']);
    const slug = await generateSlug('Hello World', async (s) => taken.has(s));
    expect(slug).toBe('hello-world-2');
  });
});
```

- [ ] **Step 7: Run the slug test**

Run: `npm test -- tests/slug.test.ts`
Expected: PASS

- [ ] **Step 8: Write `lib/markdown.ts`**

```ts
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ['src', 'alt'] },
  });
}
```

- [ ] **Step 9: Write the prompt files**

```markdown
<!-- prompts/draft-system.md -->
You are a journalist writing for a personal AI-industry newsroom. Write a
fresh 400-600 word article from the given source material. Do not copy
sentences verbatim from the source. Add context useful to practitioners.
Never invent facts that are not present in the source.

Adopt this persona's voice: {{ persona_style }}
```

```markdown
<!-- prompts/draft-user.md -->
Source article:

{{ content }}
```

```markdown
<!-- prompts/humanize-system.md -->
Rewrite the given draft to remove AI-sounding filler phrases (e.g. "delve",
"in today's fast-paced world", excessive exclamation points). Keep every
fact, keep the markdown formatting, keep the length roughly the same.
```

```markdown
<!-- prompts/humanize-user.md -->
Draft:

{{ draft }}
```

```markdown
<!-- prompts/finish-system.md -->
Given a finished article body, produce a title, the final markdown content,
and a 2-3 sentence summary suitable as a teaser. Respond only via the
provided JSON schema.
```

```markdown
<!-- prompts/finish-user.md -->
Article body:

{{ content }}
```

- [ ] **Step 10: Write the failing writeHandler test**

```ts
// tests/handlers/write.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  complete: vi.fn(),
  structured: vi.fn(),
}));

import { complete, structured } from '../../lib/llm';
import { writeHandler } from '../../lib/handlers/write';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, trigger_content, tags, status)
     VALUES ('openai', 'https://example.com/z', 'source text', $1, 'tagged') RETURNING *`,
    [JSON.stringify({ primary: 'models', secondary: [] })]
  );
  return rows[0];
}

describe('writeHandler', () => {
  it('writes title, content_md, content_html, summary, slug, persona, status=written in one UPDATE', async () => {
    (complete as any)
      .mockResolvedValueOnce('draft body')
      .mockResolvedValueOnce('humanized body');
    (structured as any).mockResolvedValue({
      title: 'A New Model Arrives',
      content_md: 'humanized body',
      summary: 'A short teaser.',
    });

    const article = await insertArticle();
    const to = await writeHandler(article as any);
    expect(to).toBe('written');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('written');
    expect(row.title).toBe('A New Model Arrives');
    expect(row.content_md).toBe('humanized body');
    expect(row.content_html).toContain('humanized body');
    expect(row.summary).toBe('A short teaser.');
    expect(row.slug).toBe('a-new-model-arrives');
    expect(row.persona).toBeTruthy();
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `npm test -- tests/handlers/write.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 12: Write `lib/handlers/write.ts`**

```ts
import { query } from '../db';
import { complete, structured } from '../llm';
import { loadPrompt } from '../prompts';
import { pickPersona } from '../personas';
import { generateSlug } from '../slug';
import { renderMarkdown } from '../markdown';
import type { Article } from '../types';

interface FinishResult {
  title: string;
  content_md: string;
  summary: string;
}

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content_md: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'content_md', 'summary'],
  additionalProperties: false,
};

async function slugExists(slug: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM articles WHERE slug = $1`, [slug]);
  return rows.length > 0;
}

export async function writeHandler(article: Article): Promise<string> {
  const primaryTag = article.tags?.primary ?? 'industry';
  const persona = pickPersona(primaryTag);

  const draft = await complete(
    loadPrompt('draft-system', { persona_style: persona.style }),
    loadPrompt('draft-user', { content: article.trigger_content ?? '' })
  );

  const humanized = await complete(
    loadPrompt('humanize-system'),
    loadPrompt('humanize-user', { draft })
  );

  const finished = await structured<FinishResult>(
    loadPrompt('finish-system'),
    loadPrompt('finish-user', { content: humanized }),
    FINISH_SCHEMA
  );

  const contentHtml = renderMarkdown(finished.content_md);
  const slug = await generateSlug(finished.title, slugExists);

  await query(
    `UPDATE articles SET
       persona = $1, title = $2, content_md = $3, content_html = $4,
       summary = $5, slug = $6, status = 'written', claimed_at = NULL
     WHERE id = $7`,
    [persona.name, finished.title, finished.content_md, contentHtml, finished.summary, slug, article.id]
  );
  return 'written';
}
```

- [ ] **Step 13: Run the write handler test**

Run: `npm test -- tests/handlers/write.test.ts`
Expected: PASS

- [ ] **Step 14: Register the handler**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';
import { writeHandler } from './write';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
  tagged: writeHandler,
};
```

- [ ] **Step 15: Commit**

```bash
git add personas.yaml lib/personas.ts lib/slug.ts lib/markdown.ts prompts/draft-system.md prompts/draft-user.md prompts/humanize-system.md prompts/humanize-user.md prompts/finish-system.md prompts/finish-user.md lib/handlers/write.ts lib/handlers/registry.ts tests/slug.test.ts tests/personas.test.ts tests/handlers/write.test.ts
git commit -m "feat: persona-driven 3-stage writing chain (draft -> humanize -> finish)"
```

---

## Task 9: Rewrite handler

**Files:**
- Create: `prompts/rewrite-system.md`, `prompts/rewrite-user.md`
- Create: `lib/handlers/rewrite.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.rewrite_requested`)
- Test: `tests/handlers/rewrite.test.ts`

**Interfaces:**
- Consumes: `complete`, `structured`, `loadPrompt`, `renderMarkdown` (Tasks 6, 8).
- Produces: `rewriteHandler(article: Article): Promise<string>` registered at `HANDLERS.rewrite_requested`.

- [ ] **Step 1: Write `prompts/rewrite-system.md`**

```markdown
You are revising an already-published-quality draft based on reviewer
feedback. Keep everything that works; change only what the feedback asks
for. Never invent facts not present in the original source material.
```

- [ ] **Step 2: Write `prompts/rewrite-user.md`**

```markdown
Reviewer feedback:

{{ feedback }}

Current article:

{{ content }}
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/handlers/rewrite.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  complete: vi.fn(),
  structured: vi.fn(),
}));

import { complete, structured } from '../../lib/llm';
import { rewriteHandler } from '../../lib/handlers/rewrite';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles
       (source_feed, trigger_url, content_md, title, slug, feedback, version, status)
     VALUES ('openai', 'https://example.com/r', 'old body', 'Old Title', 'old-title', 'make it shorter', 1, 'rewrite_requested')
     RETURNING *`
  );
  return rows[0];
}

describe('rewriteHandler', () => {
  it('applies feedback, bumps version, and returns to in_review keeping the existing slug', async () => {
    (complete as any).mockResolvedValue('rewritten body');
    (structured as any).mockResolvedValue({
      title: 'Old Title',
      content_md: 'rewritten body',
      summary: 'shorter teaser',
    });

    const article = await insertArticle();
    const to = await rewriteHandler(article as any);
    expect(to).toBe('in_review');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('in_review');
    expect(row.version).toBe(2);
    expect(row.content_md).toBe('rewritten body');
    expect(row.slug).toBe('old-title');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- tests/handlers/rewrite.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 5: Write `lib/handlers/rewrite.ts`**

```ts
import { query } from '../db';
import { complete, structured } from '../llm';
import { loadPrompt } from '../prompts';
import { renderMarkdown } from '../markdown';
import type { Article } from '../types';

interface FinishResult {
  title: string;
  content_md: string;
  summary: string;
}

const FINISH_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content_md: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['title', 'content_md', 'summary'],
  additionalProperties: false,
};

export async function rewriteHandler(article: Article): Promise<string> {
  const rewritten = await complete(
    loadPrompt('rewrite-system'),
    loadPrompt('rewrite-user', { feedback: article.feedback ?? '', content: article.content_md ?? '' })
  );

  const finished = await structured<FinishResult>(
    loadPrompt('finish-system'),
    loadPrompt('finish-user', { content: rewritten }),
    FINISH_SCHEMA
  );

  const contentHtml = renderMarkdown(finished.content_md);

  await query(
    `UPDATE articles SET
       title = $1, content_md = $2, content_html = $3, summary = $4,
       version = version + 1, status = 'in_review', claimed_at = NULL
     WHERE id = $5`,
    [finished.title, finished.content_md, contentHtml, finished.summary, article.id]
  );
  return 'in_review';
}
```

- [ ] **Step 6: Run the rewrite test**

Run: `npm test -- tests/handlers/rewrite.test.ts`
Expected: PASS

- [ ] **Step 7: Register the handler**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';
import { writeHandler } from './write';
import { rewriteHandler } from './rewrite';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
  tagged: writeHandler,
  rewrite_requested: rewriteHandler,
};
```

- [ ] **Step 8: Commit**

```bash
git add prompts/rewrite-system.md prompts/rewrite-user.md lib/handlers/rewrite.ts lib/handlers/registry.ts tests/handlers/rewrite.test.ts
git commit -m "feat: rewrite handler applies reviewer feedback and bumps version"
```

---

## Task 10: Thumbnail generation with placeholder fallback

**Files:**
- Create: `prompts/thumbnail.md`
- Create: `lib/placeholder.ts`
- Create: `lib/handlers/thumbnail.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.written` and `HANDLERS.image_requested`)
- Test: `tests/handlers/thumbnail.test.ts`

**Interfaces:**
- Consumes: `loadPrompt` (Task 6).
- Produces: `placeholderSvgDataUrl(title: string): string` from `lib/placeholder.ts`; `thumbnailHandler(article: Article, deps?: { generateImage?: (prompt: string) => Promise<Buffer>; uploadBlob?: (name: string, data: Buffer | string, contentType: string) => Promise<string> }): Promise<string>` registered at both `HANDLERS.written` and `HANDLERS.image_requested`.

- [ ] **Step 1: Write `prompts/thumbnail.md`**

```markdown
A clean, editorial-style illustration for a tech news article titled
"{{ title }}". Summary: {{ summary }}. Flat, modern, no text in the image.
```

- [ ] **Step 2: Write `lib/placeholder.ts`**

```ts
function hashHue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function placeholderSvgDataUrl(title: string): string {
  const hue = hashHue(title);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 70%, 45%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 60) % 360}, 70%, 30%)"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#g)"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/handlers/thumbnail.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';
import { thumbnailHandler } from '../../lib/handlers/thumbnail';

async function insertArticle(status = 'written') {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, title, summary, status)
     VALUES ('openai', 'https://example.com/t', 'A Title', 'A summary', $1) RETURNING *`,
    [status]
  );
  return rows[0];
}

describe('thumbnailHandler', () => {
  it('uploads a generated image to Blob and moves to in_review', async () => {
    const article = await insertArticle();
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('fake-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/generated.png',
    });
    expect(to).toBe('in_review');

    const [row] = await query<{ thumbnail_url: string; status: string }>(
      `SELECT thumbnail_url, status FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.thumbnail_url).toBe('https://blob.example.com/generated.png');
    expect(row.status).toBe('in_review');
  });

  it('falls back to a placeholder and still moves to in_review when generation fails', async () => {
    const article = await insertArticle();
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => { throw new Error('image API down'); },
      uploadBlob: vi.fn(),
    });
    expect(to).toBe('in_review');

    const [row] = await query<{ thumbnail_url: string; status: string }>(
      `SELECT thumbnail_url, status FROM articles WHERE id = $1`, [article.id]
    );
    expect(row.thumbnail_url).toContain('data:image/svg+xml');
    expect(row.status).toBe('in_review');
  });

  it('regenerates when starting from image_requested', async () => {
    const article = await insertArticle('image_requested');
    const to = await thumbnailHandler(article as any, {
      generateImage: async () => Buffer.from('new-image-bytes'),
      uploadBlob: async () => 'https://blob.example.com/new.png',
    });
    expect(to).toBe('in_review');
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npm test -- tests/handlers/thumbnail.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 5: Write `lib/handlers/thumbnail.ts`**

```ts
import { put } from '@vercel/blob';
import OpenAI from 'openai';
import { query } from '../db';
import { loadPrompt } from '../prompts';
import { placeholderSvgDataUrl } from '../placeholder';
import type { Article } from '../types';

export interface ThumbnailDeps {
  generateImage?: (prompt: string) => Promise<Buffer>;
  uploadBlob?: (name: string, data: Buffer | string, contentType: string) => Promise<string>;
}

async function defaultGenerateImage(prompt: string): Promise<Buffer> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.images.generate({
    model: process.env.IMAGE_MODEL ?? 'gpt-image-1',
    prompt,
  });
  const b64 = res.data[0].b64_json;
  if (!b64) throw new Error('image generation returned no data');
  return Buffer.from(b64, 'base64');
}

async function defaultUploadBlob(name: string, data: Buffer | string, contentType: string): Promise<string> {
  const blob = await put(name, data, { access: 'public', contentType });
  return blob.url;
}

export async function thumbnailHandler(article: Article, deps: ThumbnailDeps = {}): Promise<string> {
  const generateImage = deps.generateImage ?? defaultGenerateImage;
  const uploadBlob = deps.uploadBlob ?? defaultUploadBlob;

  let thumbnailUrl: string;
  try {
    const prompt = loadPrompt('thumbnail', { title: article.title ?? '', summary: article.summary ?? '' });
    const imageBuffer = await generateImage(prompt);
    thumbnailUrl = await uploadBlob(`thumbnails/${article.id}-${Date.now()}.png`, imageBuffer, 'image/png');
  } catch (err) {
    console.log(`[thumbnail] article ${article.id}: generation failed (${(err as Error).message}), using placeholder`);
    thumbnailUrl = placeholderSvgDataUrl(article.title ?? String(article.id));
  }

  await query(
    `UPDATE articles SET thumbnail_url = $1, status = 'in_review', claimed_at = NULL WHERE id = $2`,
    [thumbnailUrl, article.id]
  );
  return 'in_review';
}
```

- [ ] **Step 6: Run the thumbnail tests**

Run: `npm test -- tests/handlers/thumbnail.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Register the handler for both statuses**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';
import { writeHandler } from './write';
import { rewriteHandler } from './rewrite';
import { thumbnailHandler } from './thumbnail';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
  tagged: writeHandler,
  written: thumbnailHandler,
  rewrite_requested: rewriteHandler,
  image_requested: thumbnailHandler,
};
```

- [ ] **Step 8: Commit**

```bash
git add prompts/thumbnail.md lib/placeholder.ts lib/handlers/thumbnail.ts lib/handlers/registry.ts tests/handlers/thumbnail.test.ts
git commit -m "feat: thumbnail generation with deterministic placeholder fallback"
```

---

## Task 11: Publish handler

**Files:**
- Create: `lib/handlers/publish.ts`
- Modify: `lib/handlers/registry.ts` (register `HANDLERS.approved`)
- Test: `tests/handlers/publish.test.ts`

**Interfaces:**
- Consumes: `structured`, `loadPrompt`, `generateSlug` (Tasks 6, 8).
- Produces: `publishHandler(article: Article): Promise<string>` registered at `HANDLERS.approved`.

- [ ] **Step 1: Write `prompts/seo-system.md` and `prompts/seo-user.md`**

```markdown
<!-- prompts/seo-system.md -->
Write a meta description for a news article: at most 155 characters,
plain sentence(s), no markdown, no quotes around it. Respond only via the
provided JSON schema.
```

```markdown
<!-- prompts/seo-user.md -->
Title: {{ title }}

Summary: {{ summary }}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/handlers/publish.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../../lib/db';

vi.mock('../../lib/llm', () => ({
  structured: vi.fn(),
}));

import { structured } from '../../lib/llm';
import { publishHandler } from '../../lib/handlers/publish';

async function insertArticle() {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, title, summary, slug, status)
     VALUES ('openai', 'https://example.com/p', 'Great Title', 'Summary text', 'great-title', 'approved')
     RETURNING *`
  );
  return rows[0];
}

describe('publishHandler', () => {
  it('sets seo_summary, published_at, and status=published', async () => {
    (structured as any).mockResolvedValue({ seo_summary: 'A short meta description.' });
    const article = await insertArticle();

    const to = await publishHandler(article as any);
    expect(to).toBe('published');

    const [row] = await query<any>(`SELECT * FROM articles WHERE id = $1`, [article.id]);
    expect(row.status).toBe('published');
    expect(row.seo_summary).toBe('A short meta description.');
    expect(row.published_at).not.toBeNull();
    expect(row.slug).toBe('great-title');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -- tests/handlers/publish.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Write `lib/handlers/publish.ts`**

```ts
import { query } from '../db';
import { structured } from '../llm';
import { loadPrompt } from '../prompts';
import { generateSlug } from '../slug';
import type { Article } from '../types';

interface SeoResult {
  seo_summary: string;
}

const SEO_SCHEMA = {
  type: 'object',
  properties: { seo_summary: { type: 'string' } },
  required: ['seo_summary'],
  additionalProperties: false,
};

async function slugExistsForOther(slug: string, id: number): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM articles WHERE slug = $1 AND id != $2`, [slug, id]);
  return rows.length > 0;
}

export async function publishHandler(article: Article): Promise<string> {
  const seo = await structured<SeoResult>(
    loadPrompt('seo-system'),
    loadPrompt('seo-user', { title: article.title ?? '', summary: article.summary ?? '' }),
    SEO_SCHEMA
  );

  const slug = await generateSlug(article.slug ?? article.title ?? String(article.id), (s) =>
    slugExistsForOther(s, article.id)
  );

  await query(
    `UPDATE articles SET
       seo_summary = $1, slug = $2, published_at = now(), status = 'published', claimed_at = NULL
     WHERE id = $3`,
    [seo.seo_summary.slice(0, 155), slug, article.id]
  );
  return 'published';
}
```

- [ ] **Step 5: Run the publish test**

Run: `npm test -- tests/handlers/publish.test.ts`
Expected: PASS

- [ ] **Step 6: Register the handler**

```ts
// lib/handlers/registry.ts
import type { Article } from '../types';
import { scrapeHandler } from './scrape';
import { tagHandler } from './tag';
import { writeHandler } from './write';
import { rewriteHandler } from './rewrite';
import { thumbnailHandler } from './thumbnail';
import { publishHandler } from './publish';

export type Handler = (article: Article) => Promise<string>;

export const HANDLERS: Record<string, Handler> = {
  new: scrapeHandler,
  scraped: tagHandler,
  tagged: writeHandler,
  written: thumbnailHandler,
  rewrite_requested: rewriteHandler,
  image_requested: thumbnailHandler,
  approved: publishHandler,
};
```

- [ ] **Step 7: Commit**

```bash
git add prompts/seo-system.md prompts/seo-user.md lib/handlers/publish.ts lib/handlers/registry.ts tests/handlers/publish.test.ts
git commit -m "feat: publish handler finalizes SEO summary, slug, and published_at"
```

---

## Task 12: Tick and ingest API routes, deployment config

**Files:**
- Create: `app/api/tick/route.ts`
- Create: `app/api/ingest/route.ts`
- Create: `vercel.json`
- Create: `.github/workflows/tick.yml`
- Test: `tests/api/tick-auth.test.ts`

**Interfaces:**
- Consumes: `runTick` (Task 3), `ingestFeeds` (Task 4).
- Produces: `POST /api/tick`, `POST /api/ingest` — the only network-facing write paths, gated by `CRON_SECRET`.

- [ ] **Step 1: Write the failing auth test (pure function, no HTTP server needed)**

```ts
// tests/api/tick-auth.test.ts
import { describe, it, expect } from 'vitest';
import { isAuthorized } from '../../lib/auth';

describe('isAuthorized', () => {
  it('accepts the correct bearer token', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized(`Bearer test-secret`)).toBe(true);
  });

  it('rejects a missing header', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized(null)).toBe(false);
  });

  it('rejects a wrong token', () => {
    process.env.CRON_SECRET = 'test-secret';
    expect(isAuthorized('Bearer wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/api/tick-auth.test.ts`
Expected: FAIL — `lib/auth.ts` does not exist

- [ ] **Step 3: Write `lib/auth.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';

export function isAuthorized(headerValue: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !headerValue) return false;
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run the auth test**

Run: `npm test -- tests/api/tick-auth.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write `app/api/tick/route.ts`**

```ts
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { runTick } from '../../../lib/tick';
import { ingestFeeds } from '../../../lib/ingest';

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get('ingest') === '1') {
    await ingestFeeds();
  }

  const processed = await runTick();
  return NextResponse.json({ processed });
}
```

- [ ] **Step 6: Write `app/api/ingest/route.ts`**

```ts
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized } from '../../../lib/auth';
import { ingestFeeds } from '../../../lib/ingest';

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await ingestFeeds();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Write `vercel.json` (Hobby-plan daily cron backstop)**

```json
{
  "crons": [
    { "path": "/api/tick?ingest=1", "schedule": "0 6 * * *" }
  ]
}
```

- [ ] **Step 8: Write the GitHub Actions primary scheduler**

```yaml
# .github/workflows/tick.yml
name: tick
on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch: {}

jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Call tick endpoint
        run: |
          curl -sf -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/tick?ingest=1"
```

- [ ] **Step 9: Commit**

```bash
git add app/api/tick/route.ts app/api/ingest/route.ts lib/auth.ts vercel.json .github/workflows/tick.yml tests/api/tick-auth.test.ts
git commit -m "feat: tick and ingest API routes, GitHub Actions scheduler, Hobby cron backstop"
```

**Note for later manual deployment step (not part of automated tests):** after deploying, set repo secrets `CRON_SECRET` and `APP_URL` in GitHub, and verify the daily `vercel.json` cron is registered in the Vercel dashboard. Confirm two overlapping curl calls to `/api/tick` never double-process a row by checking Vercel runtime logs for duplicate `[tick] article N` lines on the same `id`.

---

## Task 13: Review UI authentication (login + middleware)

**Files:**
- Create: `middleware.ts`
- Create: `app/review/login/page.tsx`
- Create: `app/review/login/actions.ts`
- Test: `tests/reviewAuth.test.ts`

**Interfaces:**
- Produces: `verifyReviewPassword(password: string): boolean` and `REVIEW_COOKIE_NAME` from `lib/reviewAuth.ts`; middleware redirects unauthenticated `/review/*` requests (except `/review/login`) to `/review/login`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/reviewAuth.test.ts
import { describe, it, expect } from 'vitest';
import { verifyReviewPassword } from '../lib/reviewAuth';

describe('verifyReviewPassword', () => {
  it('accepts the correct password', () => {
    process.env.REVIEW_PASSWORD = 'correct-horse';
    expect(verifyReviewPassword('correct-horse')).toBe(true);
  });

  it('rejects a wrong password', () => {
    process.env.REVIEW_PASSWORD = 'correct-horse';
    expect(verifyReviewPassword('wrong')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/reviewAuth.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write `lib/reviewAuth.ts`**

```ts
import { timingSafeEqual } from 'node:crypto';

export const REVIEW_COOKIE_NAME = 'newsroom_review_session';

export function verifyReviewPassword(password: string): boolean {
  const expected = process.env.REVIEW_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run the test**

Run: `npm test -- tests/reviewAuth.test.ts`
Expected: PASS

- [ ] **Step 5: Write `middleware.ts`**

```ts
import { NextRequest, NextResponse } from 'next/server';
import { REVIEW_COOKIE_NAME } from './lib/reviewAuth';

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/review/login')) return NextResponse.next();

  const cookie = req.cookies.get(REVIEW_COOKIE_NAME);
  if (!cookie || cookie.value !== 'ok') {
    const url = req.nextUrl.clone();
    url.pathname = '/review/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/review/:path*'],
};
```

- [ ] **Step 6: Write `app/review/login/actions.ts`**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyReviewPassword, REVIEW_COOKIE_NAME } from '../../../lib/reviewAuth';

export async function login(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  if (!verifyReviewPassword(password)) {
    redirect('/review/login?error=1');
  }
  cookies().set(REVIEW_COOKIE_NAME, 'ok', { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/review');
}
```

- [ ] **Step 7: Write `app/review/login/page.tsx`**

```tsx
import { login } from './actions';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main style={{ maxWidth: 320, margin: '4rem auto', fontFamily: 'sans-serif' }}>
      <h1>Review login</h1>
      <form action={login}>
        <input type="password" name="password" placeholder="Password" autoFocus />
        <button type="submit">Log in</button>
      </form>
      {searchParams.error && <p style={{ color: 'crimson' }}>Wrong password.</p>}
    </main>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add middleware.ts lib/reviewAuth.ts app/review/login/page.tsx app/review/login/actions.ts tests/reviewAuth.test.ts
git commit -m "feat: password-gated review UI login and middleware"
```

---

## Task 14: Review list and detail views with action forms

**Files:**
- Create: `app/review/page.tsx`
- Create: `app/review/[id]/page.tsx`
- Create: `app/review/[id]/actions.ts`
- Test: `tests/reviewActions.test.ts`

**Interfaces:**
- Consumes: `query` (Task 2), `runTick` (Task 3), `REVIEW_COOKIE_NAME` (Task 13).
- Produces: server actions `approveArticle`, `requestRewrite`, `requestNewImage`, `declineArticle`, `retryArticle`, `unpublishArticle`, `runTickNow` in `app/review/[id]/actions.ts` — each does exactly one status-flipping UPDATE (or, for `runTickNow`, calls `runTick()`).

- [ ] **Step 1: Write the failing test for the action layer's DB effects**

```ts
// tests/reviewActions.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import {
  approveArticleById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
} from '../lib/reviewActions';

async function insertArticle(status: string, extra: Record<string, any> = {}) {
  const rows = await query<{ id: number }>(
    `INSERT INTO articles (source_feed, trigger_url, status, failed_from, published_at)
     VALUES ('openai', 'https://example.com/rv', $1, $2, $3) RETURNING id`,
    [status, extra.failed_from ?? null, extra.published_at ?? null]
  );
  return rows[0].id;
}

describe('review actions', () => {
  it('approve sets status=approved', async () => {
    const id = await insertArticle('in_review');
    await approveArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('approved');
  });

  it('requestRewrite stores feedback and sets status=rewrite_requested', async () => {
    const id = await insertArticle('in_review');
    await requestRewriteById(id, 'make it punchier');
    const [row] = await query<{ status: string; feedback: string }>(
      `SELECT status, feedback FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('rewrite_requested');
    expect(row.feedback).toBe('make it punchier');
  });

  it('requestNewImage sets status=image_requested', async () => {
    const id = await insertArticle('in_review');
    await requestNewImageById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('image_requested');
  });

  it('decline sets status=declined', async () => {
    const id = await insertArticle('in_review');
    await declineArticleById(id);
    const [row] = await query<{ status: string }>(`SELECT status FROM articles WHERE id=$1`, [id]);
    expect(row.status).toBe('declined');
  });

  it('retry restores failed_from and clears error', async () => {
    const id = await insertArticle('failed', { failed_from: 'tagged' });
    await retryArticleById(id);
    const [row] = await query<{ status: string; error: string | null }>(
      `SELECT status, error FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('tagged');
    expect(row.error).toBeNull();
  });

  it('unpublish sets status=declined and clears published_at', async () => {
    const id = await insertArticle('published', { published_at: new Date().toISOString() });
    await unpublishArticleById(id);
    const [row] = await query<{ status: string; published_at: string | null }>(
      `SELECT status, published_at FROM articles WHERE id=$1`, [id]
    );
    expect(row.status).toBe('declined');
    expect(row.published_at).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/reviewActions.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write `lib/reviewActions.ts`**

```ts
import { query } from './db';

export async function approveArticleById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'approved' WHERE id = $1`, [id]);
}

export async function requestRewriteById(id: number, feedback: string): Promise<void> {
  await query(
    `UPDATE articles SET status = 'rewrite_requested', feedback = $1 WHERE id = $2`,
    [feedback, id]
  );
}

export async function requestNewImageById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'image_requested' WHERE id = $1`, [id]);
}

export async function declineArticleById(id: number): Promise<void> {
  await query(`UPDATE articles SET status = 'declined' WHERE id = $1`, [id]);
}

export async function retryArticleById(id: number): Promise<void> {
  await query(
    `UPDATE articles SET status = failed_from, error = NULL WHERE id = $1`,
    [id]
  );
}

export async function unpublishArticleById(id: number): Promise<void> {
  await query(
    `UPDATE articles SET status = 'declined', published_at = NULL WHERE id = $1`,
    [id]
  );
}
```

- [ ] **Step 4: Run the review actions test**

Run: `npm test -- tests/reviewActions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write `app/review/[id]/actions.ts` (server action wrappers used by forms)**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { runTick } from '../../../lib/tick';
import {
  approveArticleById,
  requestRewriteById,
  requestNewImageById,
  declineArticleById,
  retryArticleById,
  unpublishArticleById,
} from '../../../lib/reviewActions';

export async function approveArticle(id: number) {
  await approveArticleById(id);
  revalidatePath('/review');
}

export async function requestRewrite(id: number, formData: FormData) {
  await requestRewriteById(id, String(formData.get('feedback') ?? ''));
  revalidatePath('/review');
}

export async function requestNewImage(id: number) {
  await requestNewImageById(id);
  revalidatePath('/review');
}

export async function declineArticle(id: number) {
  await declineArticleById(id);
  revalidatePath('/review');
}

export async function retryArticle(id: number) {
  await retryArticleById(id);
  revalidatePath('/review');
}

export async function unpublishArticle(id: number) {
  await unpublishArticleById(id);
  revalidatePath('/review');
}

export async function runTickNow() {
  await runTick();
  revalidatePath('/review');
}
```

- [ ] **Step 6: Write `app/review/page.tsx` (list view grouped by status)**

```tsx
import { query } from '../../lib/db';
import Link from 'next/link';
import { runTickNow } from './[id]/actions';
import type { Article } from '../../lib/types';

const GROUPS = [
  { title: 'In review', statuses: ['in_review'] },
  { title: 'Failed', statuses: ['failed'] },
  { title: 'In flight', statuses: ['new', 'scraped', 'tagged', 'written', 'rewrite_requested', 'image_requested', 'approved'] },
  { title: 'Recent published / declined', statuses: ['published', 'declined'] },
];

export default async function ReviewListPage() {
  const articles = await query<Article>(`SELECT * FROM articles ORDER BY updated_at DESC LIMIT 200`);

  return (
    <main style={{ maxWidth: 800, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Review queue</h1>
      <form action={runTickNow}>
        <button type="submit">Run tick now</button>
      </form>
      {GROUPS.map((group) => {
        const rows = articles.filter((a) => group.statuses.includes(a.status));
        if (rows.length === 0) return null;
        return (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <ul>
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/review/${a.id}`}>{a.title ?? a.trigger_title ?? a.trigger_url}</Link>
                  {' — '}
                  {a.status}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
```

- [ ] **Step 7: Write `app/review/[id]/page.tsx` (detail view + action forms)**

```tsx
import { query } from '../../../lib/db';
import type { Article } from '../../../lib/types';
import {
  approveArticle,
  requestRewrite,
  requestNewImage,
  declineArticle,
  retryArticle,
  unpublishArticle,
} from './actions';

export default async function ReviewDetailPage({ params }: { params: { id: string } }) {
  const [article] = await query<Article>(`SELECT * FROM articles WHERE id = $1`, [params.id]);
  if (!article) return <main>Not found</main>;

  const approve = approveArticle.bind(null, article.id);
  const image = requestNewImage.bind(null, article.id);
  const decline = declineArticle.bind(null, article.id);
  const retry = retryArticle.bind(null, article.id);
  const unpublish = unpublishArticle.bind(null, article.id);
  const rewrite = requestRewrite.bind(null, article.id);

  return (
    <main style={{ maxWidth: 800, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <p><a href="/review">&larr; back to queue</a></p>
      <h1>{article.title ?? article.trigger_title}</h1>
      {article.thumbnail_url && <img src={article.thumbnail_url} alt="" style={{ maxWidth: '100%' }} />}
      <p><strong>Status:</strong> {article.status} · <strong>Version:</strong> {article.version}</p>
      <p><strong>Persona:</strong> {article.persona}</p>
      <p><strong>Tags:</strong> {JSON.stringify(article.tags)}</p>
      {article.error && <p style={{ color: 'crimson' }}><strong>Error:</strong> {article.error}</p>}
      {article.content_html && <div dangerouslySetInnerHTML={{ __html: article.content_html }} />}
      <details>
        <summary>Source</summary>
        <p><a href={article.trigger_url}>{article.trigger_url}</a></p>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{article.trigger_content}</pre>
      </details>

      <hr />
      {article.status === 'in_review' && (
        <>
          <form action={approve}><button type="submit">Approve</button></form>
          <form action={rewrite}>
            <textarea name="feedback" placeholder="Rewrite feedback" />
            <button type="submit">Request rewrite</button>
          </form>
          <form action={image}><button type="submit">New image</button></form>
          <form action={decline}><button type="submit">Decline</button></form>
        </>
      )}
      {article.status === 'failed' && (
        <form action={retry}><button type="submit">Retry</button></form>
      )}
      {article.status === 'published' && (
        <form action={unpublish}><button type="submit">Unpublish</button></form>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add lib/reviewActions.ts app/review/page.tsx app/review/[id]/page.tsx app/review/[id]/actions.ts tests/reviewActions.test.ts
git commit -m "feat: review list/detail UI with approve/rewrite/image/decline/retry/unpublish actions"
```

---

## Task 15: Public site (home list + article page)

**Files:**
- Create: `app/page.tsx`
- Create: `app/articles/[slug]/page.tsx`
- Test: `tests/publicQueries.test.ts`

**Interfaces:**
- Consumes: `query` (Task 2).
- Produces: `getPublishedArticles(): Promise<Article[]>`, `getPublishedArticleBySlug(slug: string): Promise<Article | null>` from `lib/publicQueries.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/publicQueries.test.ts
import { describe, it, expect } from 'vitest';
import { query } from '../lib/db';
import { getPublishedArticles, getPublishedArticleBySlug } from '../lib/publicQueries';

describe('publicQueries', () => {
  it('returns only published articles, newest first', async () => {
    await query(
      `INSERT INTO articles (source_feed, trigger_url, status, slug, published_at)
       VALUES ('openai','https://example.com/1','published','older', now() - interval '1 day'),
              ('openai','https://example.com/2','published','newer', now()),
              ('openai','https://example.com/3','in_review','unpublished', null)`
    );
    const articles = await getPublishedArticles();
    expect(articles.map((a) => a.slug)).toEqual(['newer', 'older']);
  });

  it('fetches one published article by slug, or null if not published', async () => {
    await query(
      `INSERT INTO articles (source_feed, trigger_url, status, slug, published_at)
       VALUES ('openai','https://example.com/4','published','my-slug', now()),
              ('openai','https://example.com/5','declined','declined-slug', null)`
    );
    expect((await getPublishedArticleBySlug('my-slug'))?.slug).toBe('my-slug');
    expect(await getPublishedArticleBySlug('declined-slug')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/publicQueries.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Write `lib/publicQueries.ts`**

```ts
import { query } from './db';
import type { Article } from './types';

export async function getPublishedArticles(): Promise<Article[]> {
  return query<Article>(
    `SELECT * FROM articles WHERE status = 'published' ORDER BY published_at DESC`
  );
}

export async function getPublishedArticleBySlug(slug: string): Promise<Article | null> {
  const rows = await query<Article>(
    `SELECT * FROM articles WHERE status = 'published' AND slug = $1`, [slug]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run the public queries test**

Run: `npm test -- tests/publicQueries.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write `app/page.tsx`**

```tsx
import Link from 'next/link';
import { getPublishedArticles } from '../lib/publicQueries';

export const revalidate = 300;

export default async function HomePage() {
  const articles = await getPublishedArticles();
  return (
    <main style={{ maxWidth: 800, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Personal AI Newsroom</h1>
      <ul>
        {articles.map((a) => (
          <li key={a.id} style={{ marginBottom: '1.5rem' }}>
            {a.thumbnail_url && <img src={a.thumbnail_url} alt="" style={{ maxWidth: 200 }} />}
            <h2><Link href={`/articles/${a.slug}`}>{a.title}</Link></h2>
            <p>{a.summary}</p>
            <p><small>{a.published_at} · {a.tags?.primary}</small></p>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Write `app/articles/[slug]/page.tsx`**

```tsx
import type { Metadata } from 'next';
import { getPublishedArticleBySlug } from '../../../lib/publicQueries';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const article = await getPublishedArticleBySlug(params.slug);
  if (!article) return {};
  return {
    title: article.title ?? undefined,
    description: article.seo_summary ?? undefined,
    openGraph: { images: article.thumbnail_url ? [article.thumbnail_url] : [] },
  };
}

export const revalidate = 300;

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await getPublishedArticleBySlug(params.slug);
  if (!article) return <main>Not found</main>;

  return (
    <main style={{ maxWidth: 700, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>{article.title}</h1>
      {article.thumbnail_url && <img src={article.thumbnail_url} alt="" style={{ maxWidth: '100%' }} />}
      <p><small>{article.published_at}</small></p>
      <div dangerouslySetInnerHTML={{ __html: article.content_html ?? '' }} />
    </main>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/publicQueries.ts app/page.tsx app/articles/[slug]/page.tsx tests/publicQueries.test.ts
git commit -m "feat: public site home list and article detail pages"
```

---

## Task 16: End-to-end pipeline test and deployment checklist

**Files:**
- Test: `tests/e2e.test.ts`
- Create: `docs/deployment.md`

**Interfaces:**
- Consumes: everything from Tasks 3–11. This task adds no new production code — it proves the assembled pipeline satisfies the spec's definition of done in `FAKE_LLM` mode, then documents the manual one-time deployment steps that cannot be verified by an automated test (env vars, Vercel Blob integration, external scheduler wiring).

- [ ] **Step 1: Write the end-to-end test**

```ts
// tests/e2e.test.ts
import { describe, it, expect, vi } from 'vitest';
import { query } from '../lib/db';
import { ingestFeeds } from '../lib/ingest';
import { runTick } from '../lib/tick';

vi.mock('../lib/handlers/scrape', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/handlers/scrape')>();
  return {
    ...mod,
    scrapeHandler: (article: any) => mod.scrapeHandler(article, { extract: async () => 'A'.repeat(500) }),
  };
});

function rss(items: { title: string; link: string; description: string }[]) {
  const entries = items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><description>${i.description}</description></item>`)
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${entries}</channel></rss>`;
}

describe('end-to-end pipeline (FAKE_LLM=1)', () => {
  it('carries one feed item from ingest through to in_review in a single tick', async () => {
    process.env.FAKE_LLM = '1';
    const xml = rss([{ title: 'A New Model', link: 'https://example.com/e2e-1', description: 'A model was released.' }]);
    await ingestFeeds({ fetchFeedXml: async () => xml });

    await runTick();

    const [row] = await query<{ status: string; title: string; thumbnail_url: string }>(
      `SELECT status, title, thumbnail_url FROM articles WHERE trigger_url = 'https://example.com/e2e-1'`
    );
    expect(row.status).toBe('in_review');
    expect(row.title).toBeTruthy();
    expect(row.thumbnail_url).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 1–15 plus this end-to-end test

- [ ] **Step 3: Write `docs/deployment.md` (manual one-time steps)**

```markdown
# Deployment checklist

1. Create a Neon project, copy the **pooled** connection string into `DATABASE_URL`.
2. Run `npm run db:migrate` once against production `DATABASE_URL` (or `DATABASE_URL=<prod> npx tsx scripts/migrate.ts`).
3. Add the Vercel Blob integration to the project; it injects `BLOB_READ_WRITE_TOKEN` automatically.
4. Set env vars in Vercel: `DATABASE_URL`, `OPENAI_API_KEY`, `TEXT_MODEL`, `IMAGE_MODEL`, `CRON_SECRET`, `REVIEW_PASSWORD`, `TICK_BUDGET_MS`. Leave `FAKE_LLM` unset (defaults to real calls).
5. Deploy. Confirm `vercel.json`'s daily cron shows up under the project's Cron Jobs tab.
6. In the GitHub repo, add secrets `CRON_SECRET` (same value) and `APP_URL` (deployed URL). Confirm `.github/workflows/tick.yml` runs on schedule or via manual `workflow_dispatch`.
7. Visit `/review/login`, log in with `REVIEW_PASSWORD`, click "Run tick now" to force the first ingest+processing cycle without waiting for the scheduler.
8. Verify definition of done: a real feed item reaches `/review` as an `in_review` draft with a thumbnail within ~30 minutes of first deploy, and one Approve click later it is live at `/articles/<slug>`.
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e.test.ts docs/deployment.md
git commit -m "test: end-to-end pipeline coverage and deployment checklist"
```

---

## Build order recap

This plan follows the spec's own §13 milestones one-to-one:

1. Tasks 1–3 → milestone 1 (schema, data layer, state machine skeleton)
2. Task 4–5 → milestone 2 (ingest + scrape)
3. Tasks 6–11 → milestone 3 (LLM module, tag, write, thumbnail, rewrite, publish)
4. Task 12 → milestone 4 (tick endpoint, auth, scheduler)
5. Tasks 13–15 → milestone 5 (review UI, publish, public site)
6. Task 16 → milestone 6 (hardening: e2e proof + deployment checklist)

Not built here, per spec explicitly marking them optional/nice-to-have: in-review notifications (email/Slack/Discord/Telegram webhook). Add as a follow-up task calling a webhook at the end of `thumbnailHandler` if wanted later.
