# The AI Wire — a personal AI newsroom

A single-person, zero-infrastructure-cost newsroom: it watches AI-vendor RSS
feeds, writes original articles about new items with an LLM, routes every
draft through human review, and publishes approved articles on a public site.
Machine-drafted, human-approved — no article goes live without an explicit
click.

Built to the spec in [`spec/spec.md`](spec/spec.md).

## How it works

- **All state lives in Postgres.** An article is a row; its pipeline position
  is a `status` column. RSS items first pause at source review, then follow
  `new → scraped → tagged → rss_final_review → approved → published`; manual
  and legacy rows retain the original pipeline. No queues, no daemons.
- **The worker is a function.** `POST /api/tick` claims the next actionable
  article (`FOR UPDATE SKIP LOCKED`), runs the handler for its status, and
  loops until the queue is empty or the time budget runs out. A GitHub Actions
  workflow calls it every 5 minutes; a daily Vercel cron is the backstop.
- **Humans gate source and publication.** The password-protected `/review` desk
  first shows RSS title, feed description, and source link. First approval
  permits drafting; final approval alone permits thumbnail generation and
  publication.
- **Declined drafts are cleaned up weekly.** A GitHub Actions workflow calls
  the app to permanently remove declined articles and any thumbnails that are
  no longer referenced.
- **Published articles become podcast episodes.** A separate durable audio
  queue generates a short-form MP3 with `openai/tts-1`, stores it in Vercel
  Blob, adds a player to the article, and exposes ready episodes at
  `/podcast.xml`.
- **A weekly two-speaker review joins the same feed.** Every Monday, a separate
  GitHub Actions producer asks the app to prepare and verify a dialogue from
  the previous Brussels calendar week, renders resumable sections with
  ElevenLabs, assembles a normalized MP3, and adds it to `/podcast.xml`. Weekly
  reviews are feed-only; they do not get public episode pages.

## Stack

- **Vercel** (Hobby) — Next.js 14 App Router, Fluid compute for the 300s tick
- **Neon** (free tier) — Postgres with pgvector via the Vercel integration,
  pooled connections
- **Vercel Blob** — article thumbnails and narrated MP3s
- **Vercel AI Gateway** — text, image, and embedding model access with OIDC
  auth (no provider API keys); models are env-configurable `provider/model`
  slugs

## Local development

```bash
cp .env.example .env.local            # fill in CRON_SECRET, REVIEW_PASSWORD, APP_SECRET
docker compose -f docker-compose.test.yml up -d
docker exec vercel-news-test-db-1 psql -U postgres -c "CREATE DATABASE vercel_news_dev"
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_dev npx tsx scripts/migrate.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5433/vercel_news_test npx tsx scripts/migrate.ts
npx tsx scripts/seed-demo.ts          # optional sample articles
npm run dev
```

Set `FAKE_LLM=1` to run the whole pipeline with canned model outputs — the
test suite (`npm test`) always runs this way and costs $0.

### YouTube article submissions

Direct YouTube video URLs submitted on the review desk are canonicalized,
deduplicated, transcribed, and sent through the same tag, writing, review, and
publication pipeline as web articles. Published YouTube-backed articles embed
the source video using YouTube's privacy-enhanced player.

Set `SUPADATA_API_KEY` in `.env.local`. `YOUTUBE_TRANSCRIPT_MODE=auto` first
uses public captions and falls back to generated speech-to-text when captions
are unavailable; use `native` to disable that paid fallback. Long transcripts
are analyzed in timestamped sections so the model does not silently omit the
middle of a video. The full transcript remains visible only on the review desk.

For a local end-to-end test, start the app, submit a public YouTube URL on
`/review`, then click **Check feeds & process**. If speech-to-text returns an
asynchronous job, wait a minute and click it again. Keep `FAKE_LLM=1` if you
want to test transcript ingestion and UI rendering without paying for
article-generation model calls; Supadata transcript usage is still real.

To compare the recommended voices with a short real sample:

```bash
npm run audio:preview-voices
```

This writes ignored `alloy.mp3`, `nova.mp3`, and `onyx.mp3` files under
`voice-previews/`. Set `SPEECH_VOICE` to the winner; `alloy` is the default.

## Personal podcast feed

After the first published article has finished generating audio, add
`https://<your-domain>/podcast.xml` as a podcast by URL in Pocket Casts on
iOS. The feed is intentionally public: anyone who knows the URL can fetch it.
The audio worker creates one episode per published article version, makes up
to three persisted attempts for transient failures, and then leaves a visible
manual retry on the review desk. Existing articles are not backfilled.

Short dispatches and weekly reviews share this feed and are ordered by their
publication time. The weekly producer is idempotent by ISO week: a retry reuses
the prepared script and any completed audio sections instead of creating a
duplicate episode.

### Weekly producer configuration

The app needs the normal `APP_URL`, `CRON_SECRET`, `DATABASE_URL`, text-model,
and Blob settings. The GitHub repository also needs these Actions secrets:

- `APP_URL`
- `CRON_SECRET`
- `BLOB_READ_WRITE_TOKEN`
- `ELEVENLABS_API_KEY`

Choose two ElevenLabs voices and add their IDs as GitHub Actions variables
`WEEKLY_HOST_VOICE_ID` and `WEEKLY_ANALYST_VOICE_ID`. Use the same names in
`.env.local` to run `npm run podcast:weekly` manually. The scheduled workflow
runs Mondays at 08:17 in `Europe/Brussels`; `workflow_dispatch` remains
available for testing or retrying a week and accepts an optional ISO week such
as `2026-W30`.

The `cleanup-declined.yml` workflow uses the existing `APP_URL` and
`CRON_SECRET` secrets. It runs each Monday at 06:30 UTC and can also be run
manually from the Actions tab.

The weekly schema is durable production state. Apply the idempotent migration
before deploying this feature; never make the scheduled audio workflow run
schema migrations.

## Public article feed

Published articles are available as RSS at `https://<your-domain>/feed.xml`.
The feed includes the 50 latest articles, their summaries, and sanitized full
article HTML. It is public and can be added to any RSS reader by URL.

## Weekly newsletter

The independent `.github/workflows/weekly-newsletter.yml` action runs Mondays
at 08:17 in `Europe/Brussels`, matching the podcast schedule without reusing or
modifying the podcast workflow. It gathers unique published articles from the
previous seven complete local calendar days, drafts the intro and article
summaries through the configured AI Gateway text model, renders the newsprint
email, and sends it through a dedicated Resend path.

Configure the action with the GitHub secrets `DATABASE_URL` and the existing
`RESEND_API_KEY`. `NEWSLETTER_RECIPIENTS` and `NEWSLETTER_FROM` are optional
overrides; if omitted, the action falls back to the existing
`REVIEW_NOTIFY_EMAIL` and `REVIEW_NOTIFY_FROM` settings (with the established
`The AI Wire <onboarding@resend.dev>` sender default). Optional controls are
`NEWSLETTER_REPLY_TO`, `NEWSLETTER_MAX_ARTICLES`, and `NEWSLETTER_TEXT_MODEL`.
Manual dispatch accepts `week_ending` as an inclusive `YYYY-MM-DD` local date.
Set `dry_run` to `true` to skip all mail configuration and sending; the action
writes `newsletter-previews/weekly-newsletter-YYYY-MM-DD.html` and uploads it
as a workflow artifact. Locally, use `NEWSLETTER_DRY_RUN=true npm run
newsletter:weekly` after configuring `DATABASE_URL` and `APP_URL`.
This feature adds no database tables or migration.

After publishing to Vercel, no new Vercel setting is required for the
newsletter if the GitHub Action has the needed database, Resend, model, and
review notification values. Reuse the existing GitHub `APP_URL` secret; add
`DATABASE_URL`, `RESEND_API_KEY`, `AI_GATEWAY_API_KEY`, and
`REVIEW_NOTIFY_EMAIL` as repository secrets. Add `REVIEW_NOTIFY_FROM` as a
secret or repository variable if it is set explicitly. Leave
`NEWSLETTER_FROM` and `NEWSLETTER_RECIPIENTS` unset to deliver only to the
existing review-notification recipient. For a safe test, manually dispatch
the action with `dry_run=true` and an explicit `week_ending`; inspect the
uploaded HTML artifact. Only after that succeeds should you dispatch with
`dry_run=false` for the live test.

### Newsletter production settings

These values belong in the GitHub repository, not in Vercel. In **Settings →
Secrets and variables → Actions**, add the following as **repository secrets**:

- `APP_URL`: the deployed site URL, including `https://`.
- `DATABASE_URL`: the production Neon connection string.
- `RESEND_API_KEY`: the Resend API key used to send the message.
- `AI_GATEWAY_API_KEY`: the key used by the configured LLM integration.
- `REVIEW_NOTIFY_EMAIL`: the existing review-notification recipient. This is
  the default newsletter recipient.
- `REVIEW_NOTIFY_FROM`: the existing review-notification sender, when one is
  explicitly configured.

The newsletter-specific settings are optional **repository variables**, except
for the recipient list, which is an optional secret because it contains email
addresses:

- `NEWSLETTER_RECIPIENTS` (secret): comma-separated newsletter recipients.
  When it is blank or absent, `REVIEW_NOTIFY_EMAIL` is used instead.
- `NEWSLETTER_FROM` (variable): newsletter sender. When it is blank or absent,
  `REVIEW_NOTIFY_FROM` is used; if that is also absent, the established
  `The AI Wire <onboarding@resend.dev>` default is used.
- `NEWSLETTER_REPLY_TO` (variable): optional reply-to address; it has no
  fallback and is omitted when unset.
- `NEWSLETTER_TEXT_MODEL` (variable): optional model name; the default is
  `deepseek/deepseek-v4-flash`.
- `NEWSLETTER_MAX_ARTICLES` (variable): optional limit from 1 to 100; the
  default is 20.

Leave `NEWSLETTER_RECIPIENTS` and `NEWSLETTER_FROM` unset when the newsletter
should go only to the existing notification recipient. The scheduled action
does not need any additional Vercel configuration. To test safely, open
**Actions → weekly newsletter → Run workflow**, enter an explicit
`week_ending` such as `2026-08-09`, and set `dry_run` to `true`. Confirm that
the run succeeds and download its HTML artifact. A dry-run never calls Resend.
Only after reviewing that artifact should you run the same date with
`dry_run` set to `false`; that performs one delivery using the resolved
recipient configuration above.

## Deployment

See [`docs/deployment.md`](docs/deployment.md). Short version: link the Vercel
project, add the Neon integration and a public Blob store, set `CRON_SECRET` /
`REVIEW_PASSWORD` / `APP_SECRET` / model variables, run the migration, deploy, and point the
`tick.yml` workflow at your deployment with repo secrets `CRON_SECRET` and
`APP_URL`.
