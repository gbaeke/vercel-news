# Deployment checklist

1. Create a Neon project, copy the **pooled** connection string into `DATABASE_URL`.
2. Run the migration once against production `DATABASE_URL`:
   `DATABASE_URL=<prod-connection-string> npx tsx scripts/migrate.ts`
   This enables pgvector and creates the article embedding columns/index plus
   the durable `article_audio` queue. This is a production schema migration;
   do it before deploying code that expects the new table.
3. Backfill semantic-search vectors for articles that are already published:
   `vercel env pull .env.local --environment=production && npm run db:backfill-embeddings`
4. Add the Vercel Blob integration to the project; it injects `BLOB_READ_WRITE_TOKEN` automatically.
5. Set env vars in Vercel: `DATABASE_URL`, `TEXT_MODEL`, `IMAGE_MODEL`,
   `EMBEDDING_MODEL`, `SPEECH_MODEL=openai/tts-1`, `SPEECH_VOICE=alloy`,
   `CRON_SECRET`, `REVIEW_PASSWORD`, `APP_URL`, `TICK_BUDGET_MS`, and
   `AUDIO_JOBS_PER_TICK=1`. AI Gateway authentication is provided by Vercel
   OIDC; leave `FAKE_LLM` unset (defaults to real calls).
6. Deploy. Confirm `vercel.json`'s daily cron shows up under the project's Cron Jobs tab.
7. In the GitHub repo, add secrets `CRON_SECRET` (same value) and `APP_URL` (deployed URL). Confirm `.github/workflows/tick.yml` runs on schedule or via manual `workflow_dispatch`.
8. Visit `/review/login`, log in with `REVIEW_PASSWORD`, click "Run tick now" to force the first ingest+processing cycle without waiting for the scheduler.
9. Verify definition of done: a real feed item reaches `/review` as an
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
