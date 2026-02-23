import { query, queryOne } from './client';
import type {
  Site, CrawledPage, Entity, Action, SiteStatus, PageType,
} from '../types';

// ─── Row mappers ──────────────────────────────────────────────────────────────

function mapSite(row: Record<string, unknown>): Site {
  return {
    id: row.id as string,
    slug: row.slug as string,
    url: row.url as string,
    name: row.name as string,
    description: row.description as string,
    status: row.status as SiteStatus,
    authType: row.auth_type as Site['authType'],
    crawlDepth: row.crawl_depth as number,
    allowedPaths: row.allowed_paths as string[] | null,
    excludedPaths: row.excluded_paths as string[] | null,
    respectRobotsTxt: row.respect_robots_txt as boolean,
    lastCrawled: row.last_crawled ? new Date(row.last_crawled as string) : null,
    isPublic: row.is_public as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

function mapPage(row: Record<string, unknown>): CrawledPage {
  return {
    id: row.id as string,
    siteId: row.site_id as string,
    url: row.url as string,
    title: row.title as string,
    pageType: row.page_type as PageType,
    summary: row.summary as string,
    rawText: row.raw_text as string,
    navLinks: (row.nav_links ?? []) as CrawledPage['navLinks'],
    crawledAt: new Date(row.crawled_at as string),
  };
}

function mapEntity(row: Record<string, unknown>): Entity {
  return {
    id: row.id as string,
    siteId: row.site_id as string,
    pageId: row.page_id as string,
    name: row.name as string,
    entityType: row.entity_type as string,
    description: row.description as string,
    fields: (row.fields ?? []) as Entity['fields'],
    sampleData: row.sample_data as Record<string, unknown> | undefined,
  };
}

function mapAction(row: Record<string, unknown>): Action {
  return {
    id: row.id as string,
    siteId: row.site_id as string,
    pageId: row.page_id as string,
    name: row.name as string,
    type: row.action_type as Action['type'],
    description: row.description as string,
    inputs: (row.inputs ?? []) as Action['inputs'],
    targetUrl: row.target_url as string | undefined,
    method: row.method as Action['method'],
  };
}

// ─── Sites ────────────────────────────────────────────────────────────────────

export async function createSite(data: {
  slug: string;
  url: string;
  name: string;
  description: string;
  crawlDepth?: number;
  isPublic?: boolean;
  authType?: Site['authType'];
}): Promise<Site> {
  const rows = await query(
    `INSERT INTO sites (slug, url, name, description, crawl_depth, is_public, auth_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.slug,
      data.url,
      data.name,
      data.description,
      data.crawlDepth ?? 3,
      data.isPublic ?? true,
      data.authType ?? 'none',
    ]
  );
  return mapSite(rows[0]);
}

export async function getSiteById(id: string): Promise<Site | null> {
  const row = await queryOne('SELECT * FROM sites WHERE id = $1', [id]);
  return row ? mapSite(row) : null;
}

export async function getSiteBySlug(slug: string): Promise<Site | null> {
  const row = await queryOne('SELECT * FROM sites WHERE slug = $1', [slug]);
  return row ? mapSite(row) : null;
}

export async function getAllPublicSites(): Promise<Site[]> {
  const rows = await query(
    "SELECT * FROM sites WHERE is_public = true AND status = 'ready' ORDER BY created_at DESC"
  );
  return rows.map(mapSite);
}

export async function searchPublicSites(q: string): Promise<Site[]> {
  const rows = await query(
    `SELECT * FROM sites
     WHERE is_public = true AND status = 'ready'
       AND (name ILIKE $1 OR description ILIKE $1)
     ORDER BY created_at DESC
     LIMIT 50`,
    [`%${q}%`]
  );
  return rows.map(mapSite);
}

export async function updateSiteStatus(
  siteId: string,
  status: SiteStatus,
  lastCrawled?: Date
): Promise<void> {
  await query(
    `UPDATE sites
     SET status = $1, last_crawled = COALESCE($2, last_crawled), updated_at = NOW()
     WHERE id = $3`,
    [status, lastCrawled ?? null, siteId]
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

export async function upsertPage(
  data: Omit<CrawledPage, 'id'>
): Promise<CrawledPage> {
  const rows = await query(
    `INSERT INTO crawled_pages (site_id, url, title, page_type, summary, raw_text, nav_links, crawled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (site_id, url) DO UPDATE SET
       title      = EXCLUDED.title,
       page_type  = EXCLUDED.page_type,
       summary    = EXCLUDED.summary,
       raw_text   = EXCLUDED.raw_text,
       nav_links  = EXCLUDED.nav_links,
       crawled_at = EXCLUDED.crawled_at
     RETURNING *`,
    [
      data.siteId,
      data.url,
      data.title,
      data.pageType,
      data.summary,
      data.rawText,
      JSON.stringify(data.navLinks),
      data.crawledAt,
    ]
  );
  return mapPage(rows[0]);
}

export async function updatePageClassification(
  pageId: string,
  pageType: PageType,
  summary: string
): Promise<void> {
  await query(
    'UPDATE crawled_pages SET page_type = $1, summary = $2 WHERE id = $3',
    [pageType, summary, pageId]
  );
}

export async function getPagesBySite(siteId: string): Promise<CrawledPage[]> {
  const rows = await query(
    'SELECT * FROM crawled_pages WHERE site_id = $1 ORDER BY crawled_at DESC',
    [siteId]
  );
  return rows.map(mapPage);
}

export async function getPageByUrl(
  siteId: string,
  url: string
): Promise<CrawledPage | null> {
  const row = await queryOne(
    'SELECT * FROM crawled_pages WHERE site_id = $1 AND url = $2',
    [siteId, url]
  );
  return row ? mapPage(row) : null;
}

// ─── Entities ─────────────────────────────────────────────────────────────────

export async function saveEntities(
  entities: Array<Omit<Entity, 'id'>>
): Promise<Entity[]> {
  const results: Entity[] = [];
  for (const e of entities) {
    const rows = await query(
      `INSERT INTO entities (site_id, page_id, name, entity_type, description, fields, sample_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        e.siteId,
        e.pageId,
        e.name,
        e.entityType,
        e.description,
        JSON.stringify(e.fields),
        e.sampleData ? JSON.stringify(e.sampleData) : null,
      ]
    );
    results.push(mapEntity(rows[0]));
  }
  return results;
}

export async function getEntitiesBySite(siteId: string): Promise<Entity[]> {
  const rows = await query(
    'SELECT * FROM entities WHERE site_id = $1 ORDER BY created_at',
    [siteId]
  );
  return rows.map(mapEntity);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function saveActions(
  actions: Array<Omit<Action, 'id'>>
): Promise<Action[]> {
  const results: Action[] = [];
  for (const a of actions) {
    const rows = await query(
      `INSERT INTO actions (site_id, page_id, name, action_type, description, inputs, target_url, method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        a.siteId,
        a.pageId,
        a.name,
        a.type,
        a.description,
        JSON.stringify(a.inputs),
        a.targetUrl ?? null,
        a.method ?? null,
      ]
    );
    results.push(mapAction(rows[0]));
  }
  return results;
}

export async function getActionsBySite(siteId: string): Promise<Action[]> {
  const rows = await query(
    'SELECT * FROM actions WHERE site_id = $1 ORDER BY created_at',
    [siteId]
  );
  return rows.map(mapAction);
}

// ─── Generated specs ──────────────────────────────────────────────────────────

export async function saveGeneratedSpec(data: {
  siteId: string;
  openapiSpec: object;
  mcpManifest: object;
  agentJson: object;
}): Promise<void> {
  await query(
    `INSERT INTO generated_specs (site_id, openapi_spec, mcp_manifest, agent_json)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id) DO UPDATE SET
       openapi_spec  = EXCLUDED.openapi_spec,
       mcp_manifest  = EXCLUDED.mcp_manifest,
       agent_json    = EXCLUDED.agent_json,
       generated_at  = NOW()`,
    [
      data.siteId,
      JSON.stringify(data.openapiSpec),
      JSON.stringify(data.mcpManifest),
      JSON.stringify(data.agentJson),
    ]
  );
}

export async function getGeneratedSpec(siteId: string): Promise<{
  openapiSpec: object;
  mcpManifest: object;
  agentJson: object;
} | null> {
  const row = await queryOne(
    'SELECT openapi_spec, mcp_manifest, agent_json FROM generated_specs WHERE site_id = $1',
    [siteId]
  );
  if (!row) return null;
  return {
    openapiSpec: row.openapi_spec as object,
    mcpManifest: row.mcp_manifest as object,
    agentJson: row.agent_json as object,
  };
}

// ─── Request logging ──────────────────────────────────────────────────────────

export async function logRequest(data: {
  siteId: string;
  consumerKeyId?: string;
  toolName?: string;
  requestBody?: object;
  responseStatus: number;
  durationMs: number;
  errorMessage?: string;
}): Promise<void> {
  await query(
    `INSERT INTO request_logs
       (site_id, consumer_key_id, tool_name, request_body, response_status, duration_ms, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      data.siteId,
      data.consumerKeyId ?? null,
      data.toolName ?? null,
      data.requestBody ? JSON.stringify(data.requestBody) : null,
      data.responseStatus,
      data.durationMs,
      data.errorMessage ?? null,
    ]
  );
}
