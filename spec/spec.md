
# Personal AI Newsroom — Specification

**Target:** a single-person, zero-infrastructure-cost system that watches AI-vendor
news feeds, writes original articles about new items with an LLM, routes every
article through human review, and publishes approved articles on a public website.

**Platform:** Vercel **Hobby** plan (Next.js) + **Neon free tier** (Postgres) +
Vercel Blob (images). The only running cost is LLM API usage.

This document is self-contained: it specifies behavior, data model, and platform
constraints precisely enough to build the system from scratch. Where the stack is
stated, it is a recommendation; where behavior is stated, it is a requirement.

---

## 1. System overview

```
                    external scheduler (every 5–15 min)
                                 │  POST /api/tick  (secret header)
                                 ▼
  RSS feeds ──ingest──►  ┌───────────────┐
                         │  tick handler │  claim next actionable article,
                         │  (Next.js API │  run its next pipeline stage,
                         │   route)      │  repeat until queue empty or
                         └──────┬────────┘  ~4 min elapsed
                                │ read/write
                                ▼
                         Neon Postgres  ◄──── review UI (approve / rewrite /
                         (all state:           decline / retry) — same app,
                          articles+status)     password-protected
                                │
                                ▼
                         public site (same Next.js app renders
                         published articles from Postgres)
```

Three principles drive everything:

1. **All state lives in Postgres.** An article is a row; its pipeline position is
   a `status` column. There are no queues, no workflow engine, no background
   daemon. Anything can crash at any point and the system resumes from the last
   committed status.
2. **The worker is a function, not a process.** Vercel cannot run a long-lived
   loop, so the pipeline advances only when `/api/tick` is invoked by an external
   scheduler. Each invocation processes as many pending steps as fit in its time
   budget, then exits.
3. **A human gates publication.** No article ever goes public without an explicit
   approve action. "Waiting for review" is just a status value — it costs nothing
   and can last for days.

One Next.js app serves four surfaces: the tick endpoint, the ingest endpoint,
the private review UI, and the public article site.

---

## 2. The article state machine

Every article moves through fixed statuses. This is the core of the system;
every pipeline handler is a transition on this machine.

```
new ──► scraped ──► tagged ──► written ──► in_review ──► approved ──► published
                                              │   ▲
                     ┌────────────────────────┤   │
                     │                        │   │
                     ▼                        ▼   │
             rewrite_requested        image_requested
                     │                        │
                     └──────────► (both return to in_review)

in_review ──► declined                (terminal)
any stage ──► failed  ──retry──► back to the status it failed from
```

| Status                | Meaning                                                 | Advanced by                          |
| --------------------- | ------------------------------------------------------- | ------------------------------------ |
| `new`               | Feed item ingested, nothing processed yet               | worker                               |
| `scraped`           | Source article text extracted and stored                | worker                               |
| `tagged`            | Primary + secondary topic tags assigned                 | worker                               |
| `written`           | Draft written, humanized, summarized; thumbnail pending | worker                               |
| `in_review`         | Thumbnail done;**waits for a human**              | human action only                    |
| `rewrite_requested` | Reviewer left feedback; needs a rewrite pass            | worker                               |
| `image_requested`   | Reviewer wants a new thumbnail                          | worker                               |
| `approved`          | Human approved; publish step pending                    | worker                               |
| `published`         | Live on the public site                                 | — (terminal, but unpublish allowed) |
| `declined`          | Human rejected                                          | — (terminal)                        |
| `failed`            | A stage threw; error text stored on the row             | human retry                          |

Rules:

- **One UPDATE per transition.** Each stage writes its outputs and the new status
  in a single SQL UPDATE, so there is never partial state. A crash mid-stage
  leaves the article at its previous status; the stage simply re-runs on the next
  tick (all stages must therefore be safe to re-run — the only cost is a repeated
  LLM call).
- **Failures are data.** A handler that throws sets `status = 'failed'` and
  stores the error message and the status it failed from (`failed_from`). The
  review UI offers a retry button that sets `status = failed_from`.
- **Rewrites bump `version`** and append the reviewer feedback; the rewrite
  handler returns the article to `in_review`.

---

## 3. Data model (Postgres / Neon)

Two tables. No queue tables, no execution logs — stage transitions are `console.log`ged
(visible in Vercel's runtime logs), not modeled.

```sql
CREATE TABLE articles (
  id             SERIAL PRIMARY KEY,
  source_feed    TEXT NOT NULL,               -- feed name from config
  trigger_url    TEXT NOT NULL UNIQUE,        -- dedupe key
  trigger_title  TEXT,
  trigger_content TEXT,                       -- scraped source text
  tags           JSONB,                       -- {"primary": "...", "secondary": ["..."]}
  persona        TEXT,                        -- writing persona name used
  title          TEXT,
  content_md     TEXT,                        -- article body, markdown
  content_html   TEXT,                        -- rendered at write time
  summary        TEXT,                        -- 2-3 sentence teaser
  seo_summary    TEXT,                        -- ≤155 chars, for meta description
  slug           TEXT UNIQUE,
  thumbnail_url  TEXT,                        -- Vercel Blob URL
  feedback       TEXT,                        -- latest reviewer feedback
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'new',
  failed_from    TEXT,                        -- status to retry into
  error          TEXT,
  claimed_at     TIMESTAMPTZ,                 -- set while a tick works on the row
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ
);
CREATE INDEX articles_status_idx ON articles (status, updated_at);

CREATE TABLE feed_state (
  feed_name  TEXT PRIMARY KEY,
  last_url   TEXT                             -- most recent item URL seen
);
```

Connection notes (Neon-specific):

- Use the **pooled** connection string (or the `@neondatabase/serverless` driver)
  from Vercel functions — direct connections exhaust Neon's connection limit fast
  under serverless fan-out.
- Neon free tier autosuspends after idle; the first query after a pause takes an
  extra ~0.5–1 s. Irrelevant for this workload — do not engineer around it.
- Free tier storage (0.5 GB) fits tens of thousands of text articles. Store
  images in Vercel Blob, never in Postgres.

---

## 4. The tick endpoint (replaces a worker process)

`POST /api/tick` — the entire pipeline engine.

**Auth:** require header `Authorization: Bearer ${CRON_SECRET}`. Reject anything
else with 401. This endpoint mutates state and spends LLM money; it must not be
publicly callable.

**Algorithm:**

```
deadline = now + TICK_BUDGET_MS          (default 240_000 — leave headroom
                                          under Vercel's 300 s ceiling)
did = []
loop:
  if now >= deadline: break
  article = claim_next()                 (see below)
  if article is null: break
  handler = HANDLERS[article.status]
  try:
    await handler(article)               (each handler ends by updating
                                          status + outputs in one UPDATE,
                                          and clears claimed_at)
  catch e:
    UPDATE articles SET status='failed', failed_from=article.status,
           error=e.message, claimed_at=NULL WHERE id=article.id
  did.push({id, from: article.status, to: newStatus})
return 200 { processed: did }
```

**Claiming** must be concurrency-safe — two ticks can overlap (scheduler retries,
manual invocations):

```sql
UPDATE articles SET claimed_at = now()
WHERE id = (
  SELECT id FROM articles
  WHERE status IN ('new','scraped','tagged','written',
                   'rewrite_requested','image_requested','approved')
    AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
  ORDER BY updated_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

The `claimed_at` staleness window doubles as crash recovery: if a tick dies
mid-stage, the row becomes claimable again after 10 minutes.

**Vercel configuration:** enable Fluid compute; set `maxDuration: 300` on the
route (the Hobby-plan maximum). Set `TICK_BUDGET_MS` comfortably below it.

**Handler map:**

| From status           | Handler does                                             | To status                   |
| --------------------- | -------------------------------------------------------- | --------------------------- |
| `new`               | scrape source text (§6)                                 | `scraped` (or `failed`) |
| `scraped`           | LLM assigns tags (§7.1)                                 | `tagged`                  |
| `tagged`            | pick persona + 3-stage writing chain (§7.2)             | `written`                 |
| `written`           | generate thumbnail, upload to Blob (§8)                 | `in_review`               |
| `rewrite_requested` | rewrite with feedback, version+1 (§7.3)                 | `in_review`               |
| `image_requested`   | regenerate thumbnail                                     | `in_review`               |
| `approved`          | finalize slug + seo_summary, stamp`published_at` (§9) | `published`               |

`in_review`, `published`, `declined`, `failed` have **no handler** — they wait
for a human.

---

## 5. Ingestion

`POST /api/ingest` — same `CRON_SECRET` auth. Called by the same external
scheduler (either as a separate schedule or by having `/api/tick` run ingestion
first when a `?ingest=1` flag is set — implementer's choice; keep it in the tick
if you want only one scheduled job).

For each feed in config:

1. Fetch and parse the RSS/Atom feed.
2. Walk items newest-first; stop at the first item whose URL equals
   `feed_state.last_url`.
3. Take at most `MAX_ITEMS_PER_POLL` (default **2**) new items — this is the
   backfill guard: pointing the system at a feed with 200 historical entries
   must not enqueue 200 articles.
4. For each new item: `INSERT ... ON CONFLICT (trigger_url) DO NOTHING` with
   `status='new'`. The unique constraint is the dedupe — re-polls are harmless.
5. Update `feed_state.last_url` to the newest item's URL.

**Feed config** lives in code (a typed array), not the database:

```ts
export const FEEDS = [
  { name: "openai",  url: "https://openai.com/news/rss.xml" },
  { name: "anthropic", url: "https://www.anthropic.com/rss.xml" },
  // add more; name is stored on articles as source_feed
];
```

---

## 6. Scraping

Feed items rarely contain full article text; the scrape stage fetches the
`trigger_url` and extracts readable content.

**Fallback chain (required):**

1. **Fetch + extract:** GET the URL (realistic browser User-Agent, ~10 s
   timeout), extract main content with a readability-style library
   (`@extractus/article-extractor` or `@mozilla/readability` + `linkedom`).
2. **RSS body fallback:** if fetch fails or extraction yields < 200 characters,
   use the feed item's own description/content (store it at ingest time in
   `trigger_content` as a provisional value, or re-read the feed).
3. **Fail:** if both yield nothing usable, set `failed` with a clear error.

Serverless caveat: requests from Vercel's IP ranges are blocked by some vendor
sites more often than residential/VPS traffic. That is why the fallback chain is
required, not optional. Log which layer succeeded so degraded scraping is
visible.

Strip boilerplate, collapse whitespace, and cap stored text at ~30 kB — enough
for any prompt, and it keeps rows small.

---

## 7. LLM stages

Use one thin LLM module wrapping your provider's SDK, with two functions:

- `complete(system, user) -> string`
- `structured(system, user, schema) -> object` (JSON-schema-constrained output)

Model choice is config (`TEXT_MODEL`, `IMAGE_MODEL` env vars). Every prompt is a
markdown file in the repo (`prompts/*.md`) with `{{ placeholder }}` substitution —
prompts are content, keep them out of code so they can be tuned without touching
logic. (Repo files + redeploy is fine at personal scale; moving prompts to a DB
table with an edit page is a later upgrade, not part of this spec.)

**Fake mode (required):** when `FAKE_LLM=1`, the LLM module returns canned
deterministic outputs instead of calling the API. All tests run in fake mode;
the full pipeline must be exercisable locally for $0.

### 7.1 Tagging

`structured()` call: given `trigger_content`, choose one primary tag and up to
three secondary tags from a fixed list in config (e.g. models, tooling, research,
product, policy, industry). Store as JSONB. If the content is clearly not
AI-related news (schema includes `relevant: boolean`), set `declined`
automatically with a note in `error` — this is the spam/noise filter.

### 7.2 Writing (the 3-stage chain)

1. **Persona pick:** a handful of writing personas live in `personas.yaml`
   (name + a one-paragraph style prompt, e.g. "pragmatic engineer, dry wit,
   focuses on day-to-day workflow impact"). Either rotate/choose by tag in code,
   or ask the LLM to pick by tags. Store the persona name.
2. **Draft:** system prompt = journalist instructions + the persona's style
   prompt; user prompt = "write a fresh 400–600 word article from this source;
   do not copy sentences; add context for practitioners" + `trigger_content`.
   Never invent facts not present in the source.
3. **Humanize:** second pass that rewrites the draft to remove AI-sounding
   filler ("delve", "in today's fast-paced world", exclamation overuse), keeping
   facts, markdown, and length.
4. **Summarize + finish:** produce `summary` (2–3 sentences) via one more call
   (or as part of a structured final output: `{title, content_md, summary}`);
   render `content_md → content_html` server-side (e.g. `marked` + sanitizer);
   generate `slug` from the title (lowercase, hyphens, dedupe with a numeric
   suffix against existing slugs).

One UPDATE writes `persona, title, content_md, content_html, summary, slug, status='written'`.

### 7.3 Rewrite

Same chain, but the prompt includes the stored reviewer `feedback` and the
current `content_md`; increments `version`; returns to `in_review` (thumbnail is
kept unless the reviewer also requested a new image).

---

## 8. Thumbnails

- Generate one image per article with an image-generation API; the image prompt
  is derived from title + summary via a small prompt file.
- Upload the result to **Vercel Blob** (`put()` with public access); store the
  returned URL in `thumbnail_url`.
- On `image_requested`, generate a fresh one and overwrite the URL.
- If image generation fails, do **not** fail the article: proceed to `in_review`
  with a placeholder (a deterministic gradient/OG-style card is fine). A missing
  thumbnail must never block a publishable article.

---

## 9. Review UI (private) and publishing

A password-protected section of the same Next.js app (`/review`). Auth: simplest
possible — a single shared password checked against `REVIEW_PASSWORD` env var,
set as an httpOnly cookie via a tiny login form, enforced in middleware. (It's a
single-user system; don't build user management.)

**List view:** articles grouped by status — `in_review` first, then `failed`,
then everything in-flight, then recent `published`/`declined`.

**Detail view:** rendered article (title, thumbnail, HTML body, summary, tags,
persona, version), the original source (`trigger_url` link + scraped text in a
collapsible block), and error text if failed.

**Actions (each is a form POST that flips the status — nothing else):**

| Action                     | Effect                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Approve                    | `status = 'approved'` (worker publishes on next tick)                            |
| Request rewrite            | store feedback text,`status = 'rewrite_requested'`                               |
| New image                  | `status = 'image_requested'`                                                     |
| Decline                    | `status = 'declined'`                                                            |
| Retry (failed only)        | `status = failed_from`, clear error                                              |
| Unpublish (published only) | `status = 'declined'`, clear `published_at`                                    |
| Run tick now               | calls the tick logic inline — so you never wait for the scheduler while reviewing |

**Publish handler** (`approved → published`): generate `seo_summary` (≤155
chars, one LLM call), ensure slug uniqueness, set `published_at = now()`,
`status = 'published'`.

**Public site:** `/` lists published articles (newest first: thumbnail, title,
summary, date, tags); `/articles/[slug]` renders one article with proper
`<title>`, meta description (`seo_summary`), and OG image (`thumbnail_url`).
Render dynamically from Postgres or with short-TTL ISR — at personal traffic
levels either is fine.

An optional notification (email via Resend free tier, or a Slack/Discord/
Telegram webhook) when an article reaches `in_review` is a nice-to-have, not
required — checking `/review` with your morning coffee works.

---

## 10. Scheduling (the Hobby-plan workaround)

Vercel Hobby cron jobs run **at most once per day** with loose timing — not
enough. Use an external free scheduler as the primary trigger and Vercel's daily
cron as a backstop:

- **Primary — pick one:**
  - GitHub Actions scheduled workflow (`schedule: cron('*/15 * * * *')`) that
    `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/tick?ingest=1`.
    Free; real-world granularity ~15 min; runs can be delayed under load.
  - **cron-job.org** — free, reliable, down to 1-minute intervals, retry support.
  - **Upstash QStash** free tier — schedules with signed requests and retries.
- **Backstop:** one `vercel.json` cron hitting the same endpoint daily, so the
  pipeline still limps along if the external scheduler silently dies.

Every 10–15 minutes is the right cadence: news doesn't need faster, and an
article typically clears the whole automated path (ingest → in_review) within
one or two ticks since a single tick processes multiple stages.

---

## 11. Configuration

| Env var                                     | Purpose                                           |
| ------------------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                            | Neon**pooled** connection string            |
| `OPENAI_API_KEY` (or provider equivalent) | LLM + image generation                            |
| `TEXT_MODEL` / `IMAGE_MODEL`            | model ids, changeable without code edits          |
| `CRON_SECRET`                             | bearer token for`/api/tick` and `/api/ingest` |
| `REVIEW_PASSWORD`                         | review UI login                                   |
| `BLOB_READ_WRITE_TOKEN`                   | provided by Vercel Blob integration               |
| `FAKE_LLM`                                | `1` = canned LLM outputs (local dev / tests)    |
| `TICK_BUDGET_MS`                          | default`240000`                                 |

In-code config: `FEEDS`, tag list, `MAX_ITEMS_PER_POLL`, personas
(`personas.yaml`), prompt files (`prompts/*.md`).

---

## 12. Platform constraints (verified July 2026 — re-check before relying on them)

| Constraint                     | Value                                             | Consequence in this design                                               |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------ |
| Vercel Hobby function duration | 300 s max (Fluid compute)                         | tick budget 240 s; every stage must fit in one invocation                |
| Vercel Hobby cron              | once per day, imprecise                           | external scheduler is the real trigger                                   |
| Vercel Hobby terms             | personal, non-commercial                          | fine for a personal system; revisit if it grows an audience with revenue |
| Neon free tier                 | ~0.5 GB storage, autosuspend, limited connections | pooled connections; text in Postgres, images in Blob                     |
| Serverless egress IPs          | often blocked by news sites                       | scraping fallback chain is mandatory                                     |
| No persistent processes        | —                                                | tick-based worker;`claimed_at` staleness for crash recovery            |

---

## 13. Build order

Each milestone is independently verifiable; build in this order.

1. **Schema + data layer + state machine skeleton.** Tables, claim query,
   handler registry with no-op handlers. Verify: unit tests drive an article
   through every status with fake handlers; concurrent claim test.
2. **Ingest + scrape.** Real feeds land as `new`; scrape produces `scraped` with
   the fallback chain. Verify: point at a real feed, see rows appear with text,
   backfill guard holds.
3. **LLM module (with fake mode) + tag + write + thumbnail stages.** Verify:
   with `FAKE_LLM=1` an article runs ingest → `in_review` end-to-end in tests;
   with a real key, output quality is sane.
4. **Tick endpoint + auth + scheduler.** Deploy; wire cron-job.org/GitHub
   Actions. Verify: articles advance with no manual action; two overlapping
   ticks never double-process (claim test against the deployed DB).
5. **Review UI + publish + public site.** Verify: full loop — feed item becomes
   a draft, gets approved in the UI, appears on the public site; rewrite loop
   works and bumps version; decline and retry work.
6. **Hardening.** Placeholder thumbnails, unpublish, structured logs on every
   transition, the daily Vercel-cron backstop, optional in_review notification.

**Definition of done:** a new item published on a configured vendor feed
appears, without any manual step, as a reviewed-ready draft with thumbnail in
`/review` within ~30 minutes — and one click later it is live on the public
site.
