import { Router } from 'express';
import { getAllPublicSites, searchPublicSites } from '../../db/queries';

const router = Router();

// GET /registry — list all public ready sites
router.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const sites = q ? await searchPublicSites(q) : await getAllPublicSites();

    res.json({
      sites: sites.map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description,
        url: s.url,
        mcp_endpoint: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/sites/${s.slug}/mcp`,
        agent_json: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/sites/${s.slug}/agent.json`,
        last_crawled: s.lastCrawled?.toISOString() ?? null,
      })),
      total: sites.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error';
    res.status(500).json({ error_code: 'INTERNAL_ERROR', message: msg, retryable: false });
  }
});

export default router;
