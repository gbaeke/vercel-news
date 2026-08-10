# Deployment checklist

1. Create a Neon project, copy the **pooled** connection string into `DATABASE_URL`.
2. Run the migration once against production `DATABASE_URL`:
   `DATABASE_URL=<prod-connection-string> npx tsx scripts/migrate.ts`
   This enables pgvector and creates the article embedding columns/index plus
   the durable `article_audio` queue, weekly podcast tables, and persistent
   `rate_limits` table used by login and paid-search throttles. This is a
   production schema migration; do it before deploying code that expects the
   new tables.
3. Backfill semantic-search vectors for articles that are already published:
   `vercel env pull .env.local --environment=production && npm run db:backfill-embeddings`
4. Add the Vercel Blob integration to the project; it injects `BLOB_READ_WRITE_TOKEN` automatically.
5. Set env vars in Vercel: `DATABASE_URL`, `TEXT_MODEL`, `IMAGE_MODEL`,
   `EMBEDDING_MODEL`, `SPEECH_MODEL=openai/tts-1`, `SPEECH_VOICE=alloy`,
   `CRON_SECRET`, `REVIEW_PASSWORD`, `APP_SECRET`, `APP_URL`, `TICK_BUDGET_MS`,
   `AUDIO_JOBS_PER_TICK=1`, and optionally `SEARCH_EMBEDDING_LIMIT_PER_HOUR`
   (defaults to `100`). AI Gateway authentication is provided by Vercel
   OIDC; leave `FAKE_LLM` unset (defaults to real calls).
   Generate `APP_SECRET` from at least 32 random bytes; it signs review sessions
   and hashes rate-limit identifiers, and rotating it signs everyone out.
6. Deploy. Confirm `vercel.json`'s daily cron shows up under the project's Cron Jobs tab.
7. In the GitHub repo, add secrets `CRON_SECRET` (same value) and `APP_URL`
   (deployed URL). Confirm `.github/workflows/tick.yml` runs on schedule or via
   manual `workflow_dispatch`.
8. For the weekly two-speaker review, also add GitHub Actions secrets
   `BLOB_READ_WRITE_TOKEN` and `ELEVENLABS_API_KEY`, then add repository
   variables `WEEKLY_HOST_VOICE_ID` and `WEEKLY_ANALYST_VOICE_ID`.
   `.github/workflows/weekly-podcast.yml` runs on Monday at 08:17
   `Europe/Brussels` and can also be dispatched manually. The Action never runs
   migrations and does not commit generated media.
9. For the weekly newsletter, no new Vercel setting is required after the app
   is published: the independent GitHub Action connects directly to Neon and
   Resend. Reuse the existing GitHub `APP_URL` secret and add
   `DATABASE_URL`, `RESEND_API_KEY`, `AI_GATEWAY_API_KEY`, and
   `REVIEW_NOTIFY_EMAIL` as repository secrets. If the review sender is
   explicitly configured, also add `REVIEW_NOTIFY_FROM` as a secret or
   repository variable. Leave
   `NEWSLETTER_FROM` and `NEWSLETTER_RECIPIENTS` unset to use that same review
   recipient and sender; set them only when newsletter-specific overrides are
   desired. Optional repository variables are `NEWSLETTER_REPLY_TO`,
   `NEWSLETTER_MAX_ARTICLES`, and `NEWSLETTER_TEXT_MODEL`.
   `.github/workflows/weekly-newsletter.yml` runs independently at the same
   Monday 08:17 `Europe/Brussels` schedule as the podcast action. It supports
   a `week_ending` input in `YYYY-MM-DD` format; `dry_run=true` writes an HTML
   preview and uploads it as a workflow artifact without requiring mail
   settings or sending to recipients. This feature adds no database tables or
   production migration.
10. Safe rollout: manually dispatch `weekly newsletter` with an explicit
   `week_ending` and `dry_run=true`, then inspect/download the uploaded HTML
   artifact. After the preview is correct, manually dispatch the same date
   with `dry_run=false` for one live delivery to the configured recipient.
11. Visit `/review/login`, log in with `REVIEW_PASSWORD`, click "Run tick now" to force the first ingest+processing cycle without waiting for the scheduler.
12. Verify definition of done: a real feed item reaches `/review` as an
   `in_review` draft with a thumbnail within ~30 minutes of first deploy. One
   Approve click makes it live and queues narration; a later tick makes the
   article player and `/podcast.xml` episode available. The migration does not
   backfill audio for articles that were already published.

## Local development

Dev and tests use separate databases in the same container, so running the
test suite never wipes your dev data.

```bash
docker compose -f docker-compose.test.yml up -d
docker exec vercel-news-test-db-1 psql -U postgres -c "CREATE DATABASE vercel_news_dev"
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_dev npx tsx scripts/migrate.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_test npx tsx scripts/migrate.ts
npx tsx scripts/seed-demo.ts   # optional: sample published articles
npm run dev
```

Run the test suite (spins up against the same local Postgres container):

```bash
npm test
```

Everything runs with `FAKE_LLM=1` in tests (set automatically by `tests/setup.ts`), so the whole pipeline is exercisable for $0.
