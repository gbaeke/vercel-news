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

-- Trigger URLs the operator deleted for good. The unique constraint on
-- articles.trigger_url stops re-ingest only while the row exists, so a delete
-- leaves a tombstone here and ingest skips anything listed.
CREATE TABLE IF NOT EXISTS deleted_urls (
  url         TEXT PRIMARY KEY,
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_state (
  feed_name  TEXT PRIMARY KEY,
  last_url   TEXT
);

CREATE TABLE IF NOT EXISTS tags (
  name        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed only when the table is empty so operator deletions survive re-migration.
INSERT INTO tags (name)
SELECT unnest(ARRAY['models', 'tooling', 'research', 'product', 'policy', 'industry'])
WHERE NOT EXISTS (SELECT 1 FROM tags);

CREATE TABLE IF NOT EXISTS feeds (
  name        TEXT PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO feeds (name, url)
SELECT v.name, v.url FROM (VALUES
  ('openai', 'https://openai.com/news/rss.xml'),
  ('anthropic', 'https://www.anthropic.com/rss.xml')
) AS v(name, url)
WHERE NOT EXISTS (SELECT 1 FROM feeds);
