import { query } from '../db/client';
import { enqueueCrawl } from '../queue/jobs';

const CHECK_INTERVAL_MS = 60_000; // check every minute

interface SiteRow extends Record<string, unknown> {
  id: string;
  slug: string;
  url: string;
  recrawl_interval_hours: number;
}

let timer: NodeJS.Timeout | null = null;

async function checkAndEnqueue(): Promise<void> {
  let sites: SiteRow[] = [];
  try {
    sites = await query<SiteRow>(
      `SELECT id, slug, url, recrawl_interval_hours
       FROM sites
       WHERE status = 'ready'
         AND recrawl_interval_hours IS NOT NULL
         AND (next_crawl_at IS NULL OR next_crawl_at <= NOW())`
    ) as SiteRow[];
  } catch (err) {
    console.warn('[Scheduler] DB query failed:', (err as Error).message);
    return;
  }

  if (sites.length === 0) return;

  console.log(`[Scheduler] ${sites.length} site(s) due for re-crawl.`);

  for (const site of sites) {
    try {
      await enqueueCrawl({ siteId: site.id, siteSlug: site.slug, siteUrl: site.url });

      // Advance next_crawl_at
      await query(
        `UPDATE sites
         SET next_crawl_at = NOW() + (recrawl_interval_hours || ' hours')::interval,
             updated_at    = NOW()
         WHERE id = $1`,
        [site.id]
      );

      console.log(`[Scheduler] Enqueued re-crawl for ${site.slug} (every ${site.recrawl_interval_hours}h)`);
    } catch (err) {
      console.warn(`[Scheduler] Failed to enqueue ${site.slug}:`, (err as Error).message);
    }
  }
}

export function startScheduler(): void {
  if (timer) return;
  console.log('[Scheduler] Started — checking every 60s for due re-crawls.');
  // Run immediately, then on interval
  void checkAndEnqueue();
  timer = setInterval(() => { void checkAndEnqueue(); }, CHECK_INTERVAL_MS);
  timer.unref(); // don't keep process alive solely for the scheduler
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Scheduler] Stopped.');
  }
}
