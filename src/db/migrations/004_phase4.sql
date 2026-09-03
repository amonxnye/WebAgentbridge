-- Phase 4: Audit logs, SSO token revocation list, Prometheus labels

-- ─── Audit log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         UUID REFERENCES organizations(id),
  site_id        UUID REFERENCES sites(id),
  user_id        UUID REFERENCES users(id),
  action         TEXT NOT NULL,          -- SITE_CREATED, CRAWL_STARTED, KEY_REVOKED …
  resource_type  TEXT NOT NULL,          -- site | consumer_key | webhook | user | org
  resource_id    TEXT,
  old_values     JSONB,
  new_values     JSONB,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id    ON audit_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_site_id   ON audit_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action    ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ─── Revoked JWT jti set (for logout / SSO token invalidation) ────────────────
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT PRIMARY KEY,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Auto-clean expired revocations
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at);
