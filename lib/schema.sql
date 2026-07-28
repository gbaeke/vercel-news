CREATE EXTENSION IF NOT EXISTS vector;

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
  published_at   TIMESTAMPTZ,
  embedding      vector(768),
  embedding_model TEXT,
  embedded_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS articles_status_idx ON articles (status, updated_at);

-- Existing databases predate semantic search. Keep this migration idempotent
-- and record the model beside each vector so incompatible embedding spaces
-- can never be mixed silently after a future model change.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedding_model TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS articles_embedding_hnsw_idx
ON articles USING hnsw (embedding vector_cosine_ops)
WHERE status = 'published' AND embedding IS NOT NULL;

-- The current narrated edition of an article. Audio is deliberately separate
-- from the editorial state machine: publishing must succeed even if speech or
-- Blob storage is temporarily unavailable. Rewrites increment articles.version
-- and replace this row with a fresh pending job when the correction is
-- published.
CREATE TABLE IF NOT EXISTS article_audio (
  article_id      INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  article_version INTEGER NOT NULL CHECK (article_version > 0),
  source_hash     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  model           TEXT NOT NULL,
  voice           TEXT NOT NULL,
  blob_url        TEXT,
  byte_length     BIGINT CHECK (byte_length IS NULL OR byte_length > 0),
  media_type      TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ,
  last_error      TEXT,
  generated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    status <> 'ready'
    OR (
      blob_url IS NOT NULL
      AND byte_length IS NOT NULL
      AND media_type IS NOT NULL
      AND generated_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS article_audio_queue_idx
ON article_audio (next_attempt_at, updated_at)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS article_audio_processing_idx
ON article_audio (claimed_at)
WHERE status = 'processing';

-- A long-form weekly review is separate from article narration: it combines
-- several already-published articles, has a two-speaker script, and is rendered
-- in resumable sections by the GitHub-hosted audio producer. Ready episodes are
-- merged into the same public podcast feed as short-form article dispatches.
CREATE TABLE IF NOT EXISTS weekly_episodes (
  id               BIGSERIAL PRIMARY KEY,
  week_key         TEXT NOT NULL UNIQUE,
  period_start     TIMESTAMPTZ NOT NULL,
  period_end       TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'preparing'
                   CHECK (status IN ('preparing', 'scripted', 'generating', 'ready', 'failed')),
  title            TEXT,
  summary          TEXT,
  show_notes       TEXT,
  script           JSONB,
  script_version   INTEGER NOT NULL DEFAULT 1 CHECK (script_version > 0),
  source_hash      TEXT NOT NULL,
  script_hash      TEXT,
  provider         TEXT NOT NULL DEFAULT 'elevenlabs',
  model            TEXT NOT NULL DEFAULT 'eleven_v3',
  host_voice       TEXT,
  analyst_voice    TEXT,
  blob_url         TEXT,
  byte_length      BIGINT CHECK (byte_length IS NULL OR byte_length > 0),
  media_type       TEXT,
  duration_seconds NUMERIC CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  attempt_count    INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at       TIMESTAMPTZ,
  last_error       TEXT,
  generated_at     TIMESTAMPTZ,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (
    status <> 'ready'
    OR (
      title IS NOT NULL
      AND summary IS NOT NULL
      AND script IS NOT NULL
      AND script_hash IS NOT NULL
      AND blob_url IS NOT NULL
      AND byte_length IS NOT NULL
      AND media_type IS NOT NULL
      AND duration_seconds IS NOT NULL
      AND generated_at IS NOT NULL
      AND published_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS weekly_episodes_feed_idx
ON weekly_episodes (published_at DESC)
WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS weekly_episodes_work_idx
ON weekly_episodes (status, updated_at)
WHERE status IN ('preparing', 'scripted', 'generating', 'failed');

-- Keep a historical source snapshot so show notes survive article corrections,
-- unpublishing, or deletion. The nullable article reference is useful while the
-- source still exists but is not the only copy of its public metadata.
CREATE TABLE IF NOT EXISTS weekly_episode_sources (
  episode_id      BIGINT NOT NULL REFERENCES weekly_episodes(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL CHECK (position >= 0),
  article_id      INTEGER REFERENCES articles(id) ON DELETE SET NULL,
  article_version INTEGER NOT NULL CHECK (article_version > 0),
  title           TEXT NOT NULL,
  url             TEXT NOT NULL,
  PRIMARY KEY (episode_id, position)
);

CREATE INDEX IF NOT EXISTS weekly_episode_sources_article_idx
ON weekly_episode_sources (article_id)
WHERE article_id IS NOT NULL;

-- Dialogue is rendered in bounded sections because the provider recommends
-- short requests. A completed segment remains reusable after a later segment
-- fails, making the external audio job safe and economical to retry.
CREATE TABLE IF NOT EXISTS weekly_episode_segments (
  episode_id      BIGINT NOT NULL REFERENCES weekly_episodes(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL CHECK (position >= 0),
  turns           JSONB NOT NULL,
  source_hash     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  blob_url        TEXT,
  byte_length     BIGINT CHECK (byte_length IS NULL OR byte_length > 0),
  media_type      TEXT,
  duration_seconds NUMERIC CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error      TEXT,
  generated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, position),
  CHECK (
    status <> 'ready'
    OR (
      blob_url IS NOT NULL
      AND byte_length IS NOT NULL
      AND media_type IS NOT NULL
      AND duration_seconds IS NOT NULL
      AND generated_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS weekly_episode_segments_work_idx
ON weekly_episode_segments (episode_id, position)
WHERE status <> 'ready';

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
  -- Logical reference to a version-controlled definition in personas.yaml.
  persona_id  TEXT NOT NULL DEFAULT 'pragmatic-engineer',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing installations predate configurable persona assignments. Add and
-- backfill the reference without overwriting assignments on later migrations.
ALTER TABLE tags ADD COLUMN IF NOT EXISTS persona_id TEXT;
UPDATE tags
SET persona_id = CASE
  WHEN name IN ('policy', 'industry') THEN 'policy-watcher'
  WHEN name = 'research' THEN 'research-explainer'
  ELSE 'pragmatic-engineer'
END
WHERE persona_id IS NULL;
ALTER TABLE tags ALTER COLUMN persona_id SET DEFAULT 'pragmatic-engineer';
ALTER TABLE tags ALTER COLUMN persona_id SET NOT NULL;

-- Seed only when the table is empty so operator deletions survive re-migration.
INSERT INTO tags (name, persona_id)
SELECT v.name, v.persona_id
FROM (VALUES
  ('models', 'pragmatic-engineer'),
  ('tooling', 'pragmatic-engineer'),
  ('research', 'research-explainer'),
  ('product', 'pragmatic-engineer'),
  ('policy', 'policy-watcher'),
  ('industry', 'policy-watcher')
) AS v(name, persona_id)
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
