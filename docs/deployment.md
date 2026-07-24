# Deployment checklist

1. Create a Neon project, copy the **pooled** connection string into `DATABASE_URL`.
2. Run the migration once against production `DATABASE_URL`:
   `DATABASE_URL=<prod-connection-string> npx tsx scripts/migrate.ts`
3. Add the Vercel Blob integration to the project; it injects `BLOB_READ_WRITE_TOKEN` automatically.
4. Set env vars in Vercel: `DATABASE_URL`, `OPENAI_API_KEY`, `TEXT_MODEL`, `IMAGE_MODEL`, `CRON_SECRET`, `REVIEW_PASSWORD`, `TICK_BUDGET_MS`. Leave `FAKE_LLM` unset (defaults to real calls).
5. Deploy. Confirm `vercel.json`'s daily cron shows up under the project's Cron Jobs tab.
6. In the GitHub repo, add secrets `CRON_SECRET` (same value) and `APP_URL` (deployed URL). Confirm `.github/workflows/tick.yml` runs on schedule or via manual `workflow_dispatch`.
7. Visit `/review/login`, log in with `REVIEW_PASSWORD`, click "Run tick now" to force the first ingest+processing cycle without waiting for the scheduler.
8. Verify definition of done: a real feed item reaches `/review` as an `in_review` draft with a thumbnail within ~30 minutes of first deploy, and one Approve click later it is live at `/articles/<slug>`.

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
