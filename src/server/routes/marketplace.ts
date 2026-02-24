import { Router } from 'express';
import { query, queryOne } from '../../db/client';

const router = Router();
const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

interface MarketplaceSite {
  id: string;
  slug: string;
  name: string;
  description: string;
  url: string;
  tags: string[];
  category: string;
  star_count: number;
  last_crawled: string | null;
  page_count: string;
  entity_count: string;
}

function formatSite(r: Record<string, unknown>) {
  return {
    slug: r.slug,
    name: r.name,
    description: r.description,
    url: r.url,
    tags: r.tags ?? [],
    category: r.category ?? '',
    starCount: r.star_count ?? 0,
    lastCrawled: r.last_crawled ? new Date(r.last_crawled as string).toISOString() : null,
    pageCount: parseInt(r.page_count as string, 10),
    entityCount: parseInt(r.entity_count as string, 10),
    mcp_endpoint: `${BASE_URL}/sites/${r.slug}/mcp`,
    agent_json_url: `${BASE_URL}/sites/${r.slug}/agent.json`,
    openapi_url: `${BASE_URL}/sites/${r.slug}/openapi.json`,
  };
}

// GET /marketplace — browse public sites
router.get('/', async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim() ?? '';
  const category = (req.query.category as string | undefined)?.trim() ?? '';
  const sort = (req.query.sort as string | undefined) ?? 'stars';
  const limit = Math.min(100, parseInt((req.query.limit as string) ?? '24', 10));
  const offset = parseInt((req.query.offset as string) ?? '0', 10);

  const conditions = [`status = 'ready'`, `is_public = true`];
  const params: unknown[] = [];
  let i = 1;

  if (q) {
    conditions.push(`(name ILIKE $${i} OR description ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }
  if (category) {
    conditions.push(`category = $${i++}`);
    params.push(category);
  }

  const orderBy = sort === 'recent' ? 'last_crawled DESC NULLS LAST'
    : sort === 'pages' ? 'page_count DESC'
    : 'star_count DESC, last_crawled DESC NULLS LAST';

  try {
    const rows = await query(
      `SELECT
         s.id, s.slug, s.name, s.description, s.url, s.tags, s.category,
         s.star_count, s.last_crawled,
         (SELECT COUNT(*) FROM crawled_pages p WHERE p.site_id = s.id)::text AS page_count,
         (SELECT COUNT(*) FROM entities e WHERE e.site_id = s.id)::text AS entity_count
       FROM sites s
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM sites WHERE ${conditions.join(' AND ')}`,
      params
    );

    return res.json({
      sites: rows.map(formatSite),
      total: parseInt(countRow?.total ?? '0', 10),
      limit,
      offset,
    });
  } catch (err) {
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: (err as Error).message, retryable: false });
  }
});

// GET /marketplace/categories — distinct categories
router.get('/categories', async (_req, res) => {
  const rows = await query<{ category: string; count: string }>(
    `SELECT category, COUNT(*)::text AS count
     FROM sites
     WHERE status = 'ready' AND is_public = true AND category IS NOT NULL AND category != ''
     GROUP BY category ORDER BY count DESC`
  );
  res.json({ categories: rows.map((r) => ({ name: r.category, count: parseInt(r.count, 10) })) });
});

// GET /marketplace/:slug — site detail page
router.get('/:slug', async (req, res) => {
  const row = await queryOne(
    `SELECT
       s.id, s.slug, s.name, s.description, s.url, s.tags, s.category,
       s.star_count, s.last_crawled,
       (SELECT COUNT(*) FROM crawled_pages p WHERE p.site_id = s.id)::text AS page_count,
       (SELECT COUNT(*) FROM entities e WHERE e.site_id = s.id)::text AS entity_count
     FROM sites s
     WHERE s.slug = $1 AND s.status = 'ready' AND s.is_public = true`,
    [req.params.slug]
  );
  if (!row) return res.status(404).json({ error_code: 'NOT_FOUND', message: 'Site not found.', retryable: false });
  return res.json(formatSite(row));
});

// POST /marketplace/:slug/star — increment star count
router.post('/:slug/star', async (req, res) => {
  await query(
    `UPDATE sites SET star_count = star_count + 1 WHERE slug = $1 AND is_public = true AND status = 'ready'`,
    [req.params.slug]
  );
  const row = await queryOne<{ star_count: number }>(
    'SELECT star_count FROM sites WHERE slug = $1',
    [req.params.slug]
  );
  return res.json({ ok: true, starCount: row?.star_count ?? 0 });
});

export default router;
