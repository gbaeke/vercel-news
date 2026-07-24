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
