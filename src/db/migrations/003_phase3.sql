-- Phase 3: Organizations, users, RBAC, webhooks, marketplace enhancements

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email          TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  password_hash  TEXT,
  external_id    TEXT UNIQUE,          -- for SSO / OIDC subject claim
  is_admin       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Organizations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',   -- free | pro | enterprise
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Organization membership ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organization_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, user_id)
);

-- ─── Tie sites to orgs (optional) ─────────────────────────────────────────────
ALTER TABLE sites ADD COLUMN IF NOT EXISTS org_id       UUID REFERENCES organizations(id);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS owner_id     UUID REFERENCES users(id);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tags         TEXT[]  DEFAULT '{}';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS star_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS category     TEXT    DEFAULT '';

-- ─── Webhooks ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
  org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  events          TEXT[] NOT NULL DEFAULT '{}',
  secret          TEXT,                     -- HMAC signing secret
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  webhook_id       UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  response_status  INTEGER,
  response_body    TEXT,
  delivered_at     TIMESTAMPTZ,
  failed_at        TIMESTAMPTZ,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_site_id         ON webhooks(site_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh_id ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_sites_org_id             ON sites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id       ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id      ON organization_members(user_id);
