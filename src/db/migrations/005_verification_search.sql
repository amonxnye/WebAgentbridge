-- ── Migration 005: domain ownership verification + full-text search ──────────

-- pg_trgm enables similarity-based registry search (SRS Section 6)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Domain ownership verification columns (FR-060)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS domain_verified    BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS verified_at        TIMESTAMPTZ;

-- GIN trigram index for fast similarity search on name + description
CREATE INDEX IF NOT EXISTS idx_sites_name_trgm        ON sites USING GIN (name        gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sites_description_trgm ON sites USING GIN (description gin_trgm_ops);

-- Index to efficiently find pages with raw_text that can be purged (FR-064)
CREATE INDEX IF NOT EXISTS idx_crawled_pages_site_raw ON crawled_pages (site_id)
  WHERE raw_text IS NOT NULL;
