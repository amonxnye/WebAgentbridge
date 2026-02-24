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
    authCredentials: row.auth_credentials as Record<string, unknown> | null,
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

// ─── Site updates (Phase 2) ───────────────────────────────────────────────────

export async function updateSiteRecrawl(
  siteId: string,
  intervalHours: number | null
): Promise<void> {
  if (intervalHours === null) {
    await query(
      `UPDATE sites SET recrawl_interval_hours = NULL, next_crawl_at = NULL, updated_at = NOW() WHERE id = $1`,
      [siteId]
    );
  } else {
    await query(
      `UPDATE sites
       SET recrawl_interval_hours = $1,
           next_crawl_at = NOW() + ($1 || ' hours')::interval,
           updated_at = NOW()
       WHERE id = $2`,
      [intervalHours, siteId]
    );
  }
}

export async function updateSiteLastCrawlError(
  siteId: string,
  errorMessage: string | null
): Promise<void> {
  await query(
    'UPDATE sites SET last_crawl_error = $1, updated_at = NOW() WHERE id = $2',
    [errorMessage, siteId]
  );
}

export async function getSitesSummary(): Promise<Array<{
  id: string; slug: string; name: string; url: string; status: string;
  description: string; lastCrawled: Date | null; isPublic: boolean;
  pageCount: number; entityCount: number; actionCount: number;
  recrawlIntervalHours: number | null; tags: string[];
}>> {
  const rows = await query(
    `SELECT
       s.id, s.slug, s.name, s.url, s.status, s.description,
       s.last_crawled, s.is_public, s.recrawl_interval_hours, s.tags,
       (SELECT COUNT(*) FROM crawled_pages p WHERE p.site_id = s.id)::int  AS page_count,
       (SELECT COUNT(*) FROM entities    e WHERE e.site_id = s.id)::int  AS entity_count,
       (SELECT COUNT(*) FROM actions     a WHERE a.site_id = s.id)::int  AS action_count
     FROM sites s
     ORDER BY s.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    url: r.url as string,
    status: r.status as string,
    description: r.description as string,
    lastCrawled: r.last_crawled ? new Date(r.last_crawled as string) : null,
    isPublic: r.is_public as boolean,
    recrawlIntervalHours: r.recrawl_interval_hours as number | null,
    tags: (r.tags ?? []) as string[],
    pageCount: r.page_count as number,
    entityCount: r.entity_count as number,
    actionCount: r.action_count as number,
  }));
}

export async function deleteSite(siteId: string): Promise<void> {
  await query('DELETE FROM sites WHERE id = $1', [siteId]);
}

// ─── Consumer keys (Phase 2) ──────────────────────────────────────────────────

import { randomBytes, createHash } from 'crypto';

export async function createConsumerKey(
  siteId: string,
  label: string
): Promise<{ id: string; key: string; keyHash: string }> {
  const rawKey = 'wb_' + randomBytes(24).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const rows = await query(
    `INSERT INTO consumer_keys (site_id, key_hash, label)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [siteId, keyHash, label]
  );
  return { id: rows[0].id as string, key: rawKey, keyHash };
}

export async function getConsumerKeysBySite(siteId: string): Promise<Array<{
  id: string; label: string; isActive: boolean; lastUsed: Date | null; createdAt: Date;
}>> {
  const rows = await query(
    `SELECT id, label, is_active, last_used, created_at
     FROM consumer_keys WHERE site_id = $1 ORDER BY created_at DESC`,
    [siteId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    label: r.label as string,
    isActive: r.is_active as boolean,
    lastUsed: r.last_used ? new Date(r.last_used as string) : null,
    createdAt: new Date(r.created_at as string),
  }));
}

export async function getConsumerKeyByHash(keyHash: string): Promise<{
  id: string; siteId: string; isActive: boolean;
} | null> {
  const row = await queryOne(
    'SELECT id, site_id, is_active FROM consumer_keys WHERE key_hash = $1',
    [keyHash]
  );
  if (!row) return null;
  return { id: row.id as string, siteId: row.site_id as string, isActive: row.is_active as boolean };
}

export async function revokeConsumerKey(keyId: string): Promise<void> {
  await query(
    'UPDATE consumer_keys SET is_active = false WHERE id = $1',
    [keyId]
  );
}

// ─── Analytics (Phase 3) ──────────────────────────────────────────────────────

export async function getAnalyticsSummary(siteId: string, days = 7): Promise<{
  totalRequests: number;
  successRate: number;
  avgDurationMs: number;
  errorCount: number;
}> {
  const rows = await query(
    `SELECT
       COUNT(*)::int                                          AS total,
       COUNT(*) FILTER (WHERE response_status < 400)::int    AS success,
       COUNT(*) FILTER (WHERE response_status >= 400)::int   AS errors,
       COALESCE(AVG(duration_ms), 0)::int                    AS avg_duration
     FROM request_logs
     WHERE site_id = $1
       AND created_at >= NOW() - ($2 || ' days')::interval`,
    [siteId, days]
  );
  const r = rows[0];
  const total = (r?.total as number) ?? 0;
  const success = (r?.success as number) ?? 0;
  return {
    totalRequests: total,
    successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 100,
    avgDurationMs: (r?.avg_duration as number) ?? 0,
    errorCount: (r?.errors as number) ?? 0,
  };
}

export async function getAnalyticsTimeline(siteId: string, days = 7): Promise<Array<{
  date: string; requests: number; errors: number;
}>> {
  const rows = await query(
    `SELECT
       DATE(created_at)::text               AS date,
       COUNT(*)::int                        AS requests,
       COUNT(*) FILTER (WHERE response_status >= 400)::int AS errors
     FROM request_logs
     WHERE site_id = $1
       AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY DATE(created_at)
     ORDER BY DATE(created_at)`,
    [siteId, days]
  );
  return rows.map((r) => ({
    date: r.date as string,
    requests: r.requests as number,
    errors: r.errors as number,
  }));
}

export async function getTopTools(siteId: string, limit = 10): Promise<Array<{
  toolName: string; callCount: number;
}>> {
  const rows = await query(
    `SELECT tool_name, COUNT(*)::int AS call_count
     FROM request_logs
     WHERE site_id = $1 AND tool_name IS NOT NULL
     GROUP BY tool_name
     ORDER BY call_count DESC
     LIMIT $2`,
    [siteId, limit]
  );
  return rows.map((r) => ({
    toolName: r.tool_name as string,
    callCount: r.call_count as number,
  }));
}

// ─── Webhooks (Phase 3) ───────────────────────────────────────────────────────

export async function createWebhook(data: {
  siteId?: string;
  orgId?: string;
  url: string;
  events: string[];
  secret?: string;
}): Promise<{ id: string }> {
  const rows = await query(
    `INSERT INTO webhooks (site_id, org_id, url, events, secret)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [data.siteId ?? null, data.orgId ?? null, data.url, data.events, data.secret ?? null]
  );
  return { id: rows[0].id as string };
}

export async function getWebhooksBySite(siteId: string): Promise<Array<{
  id: string; url: string; events: string[]; isActive: boolean; lastTriggered: Date | null; createdAt: Date;
}>> {
  const rows = await query(
    'SELECT id, url, events, is_active, last_triggered, created_at FROM webhooks WHERE site_id = $1 ORDER BY created_at DESC',
    [siteId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    url: r.url as string,
    events: r.events as string[],
    isActive: r.is_active as boolean,
    lastTriggered: r.last_triggered ? new Date(r.last_triggered as string) : null,
    createdAt: new Date(r.created_at as string),
  }));
}

export async function deleteWebhook(webhookId: string): Promise<void> {
  await query('DELETE FROM webhooks WHERE id = $1', [webhookId]);
}

export async function getWebhookDeliveries(webhookId: string): Promise<Array<{
  id: string; eventType: string; responseStatus: number | null;
  deliveredAt: Date | null; failedAt: Date | null; errorMessage: string | null; createdAt: Date;
}>> {
  const rows = await query(
    `SELECT id, event_type, response_status, delivered_at, failed_at, error_message, created_at
     FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [webhookId]
  );
  return rows.map((r) => ({
    id: r.id as string,
    eventType: r.event_type as string,
    responseStatus: r.response_status as number | null,
    deliveredAt: r.delivered_at ? new Date(r.delivered_at as string) : null,
    failedAt: r.failed_at ? new Date(r.failed_at as string) : null,
    errorMessage: r.error_message as string | null,
    createdAt: new Date(r.created_at as string),
  }));
}

// ─── Users (Phase 3/4) ────────────────────────────────────────────────────────

export async function createUser(data: {
  email: string;
  name: string;
  passwordHash?: string;
  externalId?: string;
  isAdmin?: boolean;
}): Promise<{ id: string; email: string; name: string }> {
  const rows = await query(
    `INSERT INTO users (email, name, password_hash, external_id, is_admin)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name`,
    [data.email, data.name, data.passwordHash ?? null, data.externalId ?? null, data.isAdmin ?? false]
  );
  return { id: rows[0].id as string, email: rows[0].email as string, name: rows[0].name as string };
}

export async function getUserByEmail(email: string): Promise<{
  id: string; email: string; name: string; passwordHash: string | null; isAdmin: boolean;
} | null> {
  const row = await queryOne(
    'SELECT id, email, name, password_hash, is_admin FROM users WHERE email = $1',
    [email]
  );
  if (!row) return null;
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    passwordHash: row.password_hash as string | null,
    isAdmin: row.is_admin as boolean,
  };
}

// ─── Audit log (Phase 4) ──────────────────────────────────────────────────────

export async function writeAuditLog(data: {
  action: string;
  resourceType: string;
  resourceId?: string;
  siteId?: string;
  orgId?: string;
  userId?: string;
  oldValues?: object;
  newValues?: object;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  await query(
    `INSERT INTO audit_logs
       (action, resource_type, resource_id, site_id, org_id, user_id,
        old_values, new_values, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      data.action,
      data.resourceType,
      data.resourceId ?? null,
      data.siteId ?? null,
      data.orgId ?? null,
      data.userId ?? null,
      data.oldValues ? JSON.stringify(data.oldValues) : null,
      data.newValues ? JSON.stringify(data.newValues) : null,
      data.ipAddress ?? null,
      data.userAgent ?? null,
    ]
  ).catch(() => {}); // audit failures must never block the main flow
}

export async function getAuditLogs(filters: {
  siteId?: string;
  orgId?: string;
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{
  id: string; action: string; resourceType: string; resourceId: string | null;
  siteId: string | null; userId: string | null; ipAddress: string | null;
  createdAt: Date;
}>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (filters.siteId)   { conditions.push(`site_id = $${i++}`);  params.push(filters.siteId); }
  if (filters.orgId)    { conditions.push(`org_id = $${i++}`);   params.push(filters.orgId); }
  if (filters.userId)   { conditions.push(`user_id = $${i++}`);  params.push(filters.userId); }
  if (filters.action)   { conditions.push(`action = $${i++}`);   params.push(filters.action); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const rows = await query(
    `SELECT id, action, resource_type, resource_id, site_id, user_id, ip_address, created_at
     FROM audit_logs ${where}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return rows.map((r) => ({
    id: r.id as string,
    action: r.action as string,
    resourceType: r.resource_type as string,
    resourceId: r.resource_id as string | null,
    siteId: r.site_id as string | null,
    userId: r.user_id as string | null,
    ipAddress: r.ip_address as string | null,
    createdAt: new Date(r.created_at as string),
  }));
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
