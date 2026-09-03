-- Phase 2: Re-crawl scheduling, crawl error tracking, auth credentials index

ALTER TABLE sites ADD COLUMN IF NOT EXISTS recrawl_interval_hours INTEGER;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS next_crawl_at             TIMESTAMPTZ;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS last_crawl_error          TEXT;

-- Index for the scheduler query
CREATE INDEX IF NOT EXISTS idx_sites_next_crawl_at ON sites(next_crawl_at)
  WHERE status = 'ready' AND recrawl_interval_hours IS NOT NULL;

-- Ensure auth_credentials is indexed for fast lookup
CREATE INDEX IF NOT EXISTS idx_consumer_keys_site_id ON consumer_keys(site_id);
