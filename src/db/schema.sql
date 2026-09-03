CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Sites ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sites (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug                TEXT UNIQUE NOT NULL,
  url                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'pending',
  auth_type           TEXT NOT NULL DEFAULT 'none',
  auth_credentials    JSONB,
  crawl_depth         INTEGER NOT NULL DEFAULT 3,
  allowed_paths       TEXT[],
  excluded_paths      TEXT[],
  respect_robots_txt  BOOLEAN NOT NULL DEFAULT true,
  last_crawled        TIMESTAMPTZ,
  is_public           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Crawled pages ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crawled_pages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  page_type   TEXT NOT NULL DEFAULT 'other',
  summary     TEXT NOT NULL DEFAULT '',
  raw_text    TEXT NOT NULL DEFAULT '',
  nav_links   JSONB NOT NULL DEFAULT '[]',
  crawled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, url)
);

-- ─── Entities extracted from pages ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id      UUID NOT NULL REFERENCES crawled_pages(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  fields       JSONB NOT NULL DEFAULT '[]',
  sample_data  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Actions discovered on pages ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS actions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  page_id      UUID NOT NULL REFERENCES crawled_pages(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  inputs       JSONB NOT NULL DEFAULT '[]',
  target_url   TEXT,
  method       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Generated API specs ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generated_specs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id       UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  openapi_spec  JSONB NOT NULL,
  mcp_manifest  JSONB NOT NULL,
  agent_json    JSONB NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id)
);

-- ─── Consumer API keys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consumer_keys (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL DEFAULT '',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_used   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Request logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS request_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id          UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  consumer_key_id  UUID REFERENCES consumer_keys(id),
  tool_name        TEXT,
  request_body     JSONB,
  response_status  INTEGER NOT NULL,
  duration_ms      INTEGER NOT NULL,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_crawled_pages_site_id   ON crawled_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_entities_site_id        ON entities(site_id);
CREATE INDEX IF NOT EXISTS idx_actions_site_id         ON actions(site_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_site_id    ON request_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_sites_status            ON sites(status);
CREATE INDEX IF NOT EXISTS idx_sites_is_public         ON sites(is_public);
