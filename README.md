# The AI Wire — a personal AI newsroom

A single-person, zero-infrastructure-cost newsroom: it watches AI-vendor RSS
feeds, writes original articles about new items with an LLM, routes every
draft through human review, and publishes approved articles on a public site.
Machine-drafted, human-approved — no article goes live without an explicit
click.

Built to the spec in [`spec/spec.md`](spec/spec.md).

## How it works

- **All state lives in Postgres.** An article is a row; its pipeline position
  is a `status` column (`new → scraped → tagged → written → in_review →
  approved → published`). No queues, no daemons.
- **The worker is a function.** `POST /api/tick` claims the next actionable
  article (`FOR UPDATE SKIP LOCKED`), runs the handler for its status, and
  loops until the queue is empty or the time budget runs out. A GitHub Actions
  workflow calls it every 5 minutes; a daily Vercel cron is the backstop.
- **A human gates publication.** The password-protected `/review` desk shows
  every draft with its pipeline position; approve publishes immediately,
  rewrite/decline/retry are one click each.

## Stack

- **Vercel** (Hobby) — Next.js 14 App Router, Fluid compute for the 300s tick
- **Neon** (free tier) — Postgres with pgvector via the Vercel integration,
  pooled connections
- **Vercel Blob** — article thumbnails
- **Vercel AI Gateway** — text, image, and embedding model access with OIDC
  auth (no provider API keys); models are env-configurable `provider/model`
  slugs

## Local development

```bash
cp .env.example .env.local            # fill in CRON_SECRET, REVIEW_PASSWORD
docker compose -f docker-compose.test.yml up -d
docker exec vercel-news-test-db-1 psql -U postgres -c "CREATE DATABASE vercel_news_dev"
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_dev npx tsx scripts/migrate.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_test npx tsx scripts/migrate.ts
npx tsx scripts/seed-demo.ts          # optional sample articles
npm run dev
```

Set `FAKE_LLM=1` to run the whole pipeline with canned model outputs — the
test suite (`npm test`) always runs this way and costs $0.

## Deployment

See [`docs/deployment.md`](docs/deployment.md). Short version: link the Vercel
project, add the Neon integration and a public Blob store, set `CRON_SECRET` /
`REVIEW_PASSWORD` / `TEXT_MODEL` / `IMAGE_MODEL` / `EMBEDDING_MODEL`, run the
migration and embedding backfill, deploy, and point the `tick.yml` workflow at
your deployment with repo secrets `CRON_SECRET` and `APP_URL`.
