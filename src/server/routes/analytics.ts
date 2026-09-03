import { Router } from 'express';
import {
  getSiteBySlug,
  getAnalyticsSummary,
  getAnalyticsTimeline,
  getTopTools,
} from '../../db/queries';
import { query } from '../../db/client';
import { requireApiKey } from '../middleware/auth';

const router = Router({ mergeParams: true });

// GET /api/sites/:slug/analytics?days=7
router.get('/', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const days = Math.min(90, Math.max(1, parseInt((req.query.days as string) ?? '7', 10)));

  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const [summary, timeline, topTools] = await Promise.all([
    getAnalyticsSummary(site.id, days),
    getAnalyticsTimeline(site.id, days),
    getTopTools(site.id, 10),
  ]);

  return res.json({
    site_slug: slug,
    period_days: days,
    summary,
    timeline,
    top_tools: topTools,
  });
});

// GET /api/analytics — platform-wide stats
router.get('/global', requireApiKey, async (_req, res) => {
  try {
    const [siteStats, reqStats] = await Promise.all([
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count FROM sites GROUP BY status`
      ),
      query<{ total: string; success: string; errors: string }>(
        `SELECT
           COUNT(*)::text AS total,
           COUNT(*) FILTER (WHERE response_status < 400)::text AS success,
           COUNT(*) FILTER (WHERE response_status >= 400)::text AS errors
         FROM request_logs
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
    ]);

    return res.json({
      sites: Object.fromEntries(siteStats.map((r) => [r.status, parseInt(r.count, 10)])),
      requests_7d: {
        total: parseInt(reqStats[0]?.total ?? '0', 10),
        success: parseInt(reqStats[0]?.success ?? '0', 10),
        errors: parseInt(reqStats[0]?.errors ?? '0', 10),
      },
    });
  } catch (err) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: (err as Error).message, retryable: false });
  }
});

export default router;
