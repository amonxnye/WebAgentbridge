import { Router } from 'express';
import slugify from 'slugify';
import {
  createSite, getSiteBySlug, getSitesSummary, updateSiteStatus,
  updateSiteRecrawl, updateSiteLastCrawlError, deleteSite,
  getPagesBySite, getEntitiesBySite, getActionsBySite, getGeneratedSpec,
  writeAuditLog,
} from '../../db/queries';
import { enqueueCrawl } from '../../queue/jobs';
import { requireApiKey } from '../middleware/auth';
import { attachJwt } from '../middleware/jwt';

const router = Router();
const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

// ── GET /api/sites ─────────────────────────────────────────────────────────────
router.get('/', requireApiKey, async (_req, res) => {
  try {
    const sites = await getSitesSummary();
    res.json({
      sites: sites.map((s) => ({
        ...s,
        lastCrawled: s.lastCrawled?.toISOString() ?? null,
        mcp_endpoint: `${BASE_URL}/sites/${s.slug}/mcp`,
        agent_json_url: `${BASE_URL}/sites/${s.slug}/agent.json`,
      })),
      total: sites.length,
    });
  } catch (err) {
    res.status(500).json({ error_code: 'INTERNAL_ERROR', message: (err as Error).message, retryable: false });
  }
});

// ── POST /api/sites ────────────────────────────────────────────────────────────
router.post('/', requireApiKey, attachJwt, async (req, res) => {
  const {
    url, name, description = '', crawlDepth = 3, isPublic = true,
    authType = 'none', authCredentials, recrawlIntervalHours, tags = [], category = '',
  } = req.body as {
    url: string; name?: string; description?: string; crawlDepth?: number;
    isPublic?: boolean; authType?: string; authCredentials?: object;
    recrawlIntervalHours?: number; tags?: string[]; category?: string;
  };

  if (!url) return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'url is required', retryable: false });

  let parsed: URL;
  try { parsed = new URL(url); } catch {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'Invalid URL', retryable: false });
  }

  const slug = slugify(parsed.hostname, { lower: true, strict: true });
  const siteName = name ?? parsed.hostname;

  const existing = await getSiteBySlug(slug).catch(() => null);
  if (existing) {
    return res.status(409).json({ error_code: 'CONFLICT', message: `Site "${slug}" already registered.`, retryable: false });
  }

  try {
    const site = await createSite({ slug, url, name: siteName, description, crawlDepth, isPublic, authType: authType as 'none' });

    if (recrawlIntervalHours) {
      await updateSiteRecrawl(site.id, recrawlIntervalHours);
    }

    await writeAuditLog({
      action: 'SITE_CREATED',
      resourceType: 'site',
      resourceId: site.id,
      siteId: site.id,
      userId: req.jwtUser?.sub,
      newValues: { slug, url, name: siteName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Enqueue crawl
    await enqueueCrawl({ siteId: site.id, siteSlug: site.slug, siteUrl: site.url });

    return res.status(201).json({
      site: { ...site, lastCrawled: null },
      mcp_endpoint: `${BASE_URL}/sites/${slug}/mcp`,
      agent_json_url: `${BASE_URL}/sites/${slug}/agent.json`,
    });
  } catch (err) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: (err as Error).message, retryable: false });
  }
});

// ── GET /api/sites/:slug ───────────────────────────────────────────────────────
router.get('/:slug', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const [pages, entities, actions, spec] = await Promise.all([
    getPagesBySite(site.id),
    getEntitiesBySite(site.id),
    getActionsBySite(site.id),
    getGeneratedSpec(site.id).catch(() => null),
  ]);

  return res.json({
    site: { ...site, lastCrawled: site.lastCrawled?.toISOString() ?? null },
    pages: pages.slice(0, 20).map((p) => ({
      url: p.url, title: p.title, pageType: p.pageType, summary: p.summary,
      crawledAt: p.crawledAt.toISOString(),
    })),
    pageCount: pages.length,
    entityTypes: [...new Set(entities.map((e) => e.entityType))],
    entityCount: entities.length,
    actionCount: actions.length,
    hasSpec: !!spec,
    mcp_endpoint: `${BASE_URL}/sites/${slug}/mcp`,
    agent_json_url: `${BASE_URL}/sites/${slug}/agent.json`,
    openapi_url: `${BASE_URL}/sites/${slug}/openapi.json`,
  });
});

// ── PATCH /api/sites/:slug ─────────────────────────────────────────────────────
router.patch('/:slug', requireApiKey, attachJwt, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const { recrawlIntervalHours } = req.body as { recrawlIntervalHours?: number | null };

  if (recrawlIntervalHours !== undefined) {
    await updateSiteRecrawl(site.id, recrawlIntervalHours);
  }

  await writeAuditLog({
    action: 'SITE_UPDATED',
    resourceType: 'site',
    resourceId: site.id,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    newValues: req.body as object,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true });
});

// ── DELETE /api/sites/:slug ────────────────────────────────────────────────────
router.delete('/:slug', requireApiKey, attachJwt, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  await deleteSite(site.id);
  await writeAuditLog({
    action: 'SITE_DELETED',
    resourceType: 'site',
    resourceId: site.id,
    userId: req.jwtUser?.sub,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, message: `Site "${slug}" deleted.` });
});

// ── POST /api/sites/:slug/recrawl ──────────────────────────────────────────────
router.post('/:slug/recrawl', requireApiKey, attachJwt, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  if (site.status === 'crawling') {
    return res.status(409).json({ error_code: 'CRAWL_IN_PROGRESS', message: 'A crawl is already in progress for this site.', retryable: true });
  }

  await updateSiteStatus(site.id, 'pending');
  await updateSiteLastCrawlError(site.id, null);
  const jobId = await enqueueCrawl({ siteId: site.id, siteSlug: site.slug, siteUrl: site.url });

  await writeAuditLog({
    action: 'CRAWL_TRIGGERED',
    resourceType: 'site',
    resourceId: site.id,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, jobId, message: `Re-crawl enqueued for "${slug}".` });
});

export default router;
