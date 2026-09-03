import { Router } from 'express';
import { chromium } from 'playwright';
import {
  getSiteBySlug,
  getPagesBySite,
  getPageByUrl,
  getEntitiesBySite,
  getActionsBySite,
  getGeneratedSpec,
  logRequest,
} from '../../db/queries';
import { requireApiKey } from '../middleware/auth';
import { generateLlmsTxt } from '../../generator/llms-txt';
import type { JsonRpcRequest, JsonRpcResponse, MCPManifest, CrawledPage, Entity } from '../../types';

const router = Router({ mergeParams: true });

const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';
const PAGE_TIMEOUT_MS = parseInt(process.env.CRAWL_PAGE_TIMEOUT_MS ?? '30000', 10);

// Helper — build a JSON-RPC success response
function rpcOk(id: JsonRpcRequest['id'], result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

// Helper — build a JSON-RPC error response
function rpcError(
  id: JsonRpcRequest['id'],
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// ── MCP initialize ────────────────────────────────────────────────────────────
async function handleInitialize(
  id: JsonRpcRequest['id'],
  slug: string
): Promise<JsonRpcResponse> {
  const site = await getSiteBySlug(slug);
  if (!site) return rpcError(id, -32602, `Site not found: ${slug}`);

  return rpcOk(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
    serverInfo: {
      name: `WebBridge — ${site.name}`,
      version: '1.0.0',
    },
  });
}

// ── tools/list ────────────────────────────────────────────────────────────────
async function handleToolsList(
  id: JsonRpcRequest['id'],
  slug: string
): Promise<JsonRpcResponse> {
  const spec = await getGeneratedSpec(await getSlugId(slug));
  if (!spec) return rpcError(id, -32602, `Site "${slug}" not ready. Run ingestion first.`);

  const manifest = spec.mcpManifest as MCPManifest;
  return rpcOk(id, { tools: manifest.tools });
}

// ── tools/call ────────────────────────────────────────────────────────────────
async function handleToolsCall(
  id: JsonRpcRequest['id'],
  slug: string,
  params: unknown
): Promise<JsonRpcResponse> {
  const p = params as { name: string; arguments?: Record<string, unknown> };
  const toolName = p?.name;
  const args = p?.arguments ?? {};

  if (!toolName) return rpcError(id, -32602, 'Missing required param: name');

  const site = await getSiteBySlug(slug);
  if (!site) return rpcError(id, -32602, `Site not found: ${slug}`);
  if (site.status !== 'ready')
    return rpcError(id, -32602, `Site "${slug}" not ready. Status: ${site.status}`);

  // ── get_site_info ──────────────────────────────────────────────────────────
  if (toolName === 'get_site_info') {
    const [pages, entities, actions] = await Promise.all([
      getPagesBySite(site.id),
      getEntitiesBySite(site.id),
      getActionsBySite(site.id),
    ]);
    return rpcOk(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          name: site.name,
          description: site.description,
          url: site.url,
          last_crawled: site.lastCrawled?.toISOString() ?? null,
          page_count: pages.length,
          entity_types: [...new Set(entities.map((e) => e.entityType))],
          action_count: actions.length,
          mcp_endpoint: `${BASE_URL}/sites/${slug}/mcp`,
        }, null, 2),
      }],
    });
  }

  // ── list_pages ─────────────────────────────────────────────────────────────
  if (toolName === 'list_pages') {
    let pages = await getPagesBySite(site.id);
    if (args.page_type) {
      pages = pages.filter((p) => p.pageType === args.page_type);
    }
    const limit = Math.min(Number(args.limit ?? 20), 100);

    // Cursor-based pagination (FR-065): cursor is the URL of the last item seen.
    // Falls back to offset if no cursor provided.
    let startIdx = Number(args.offset ?? 0);
    if (args.cursor) {
      const cursorIdx = pages.findIndex((p) => p.url === String(args.cursor));
      startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
    }
    const slice = pages.slice(startIdx, startIdx + limit);
    const nextCursor = slice.length === limit && startIdx + limit < pages.length
      ? slice[slice.length - 1].url
      : null;

    return rpcOk(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          pages: slice.map((p) => ({
            url: p.url,
            title: p.title,
            page_type: p.pageType,
            summary: p.summary,
            last_crawled: p.crawledAt.toISOString(),
          })),
          total: pages.length,
          limit,
          cursor: args.cursor ?? null,
          next_cursor: nextCursor,
        }, null, 2),
      }],
    });
  }

  // ── get_page ───────────────────────────────────────────────────────────────
  if (toolName === 'get_page') {
    if (!args.url) return rpcError(id, -32602, 'Missing required argument: url');
    const page = await getPageByUrl(site.id, String(args.url));
    if (!page) {
      return rpcError(id, -32602, `Page not found in crawl snapshot: ${args.url}`);
    }
    return rpcOk(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          url: page.url,
          title: page.title,
          page_type: page.pageType,
          summary: page.summary,
          text_content: page.rawText,
          last_crawled: page.crawledAt.toISOString(),
        }, null, 2),
      }],
    });
  }

  // ── list_<entity_type> ─────────────────────────────────────────────────────
  if (toolName.startsWith('list_')) {
    const entityType = toolName.replace(/^list_/, '');
    const entities = await getEntitiesBySite(site.id);
    const matching = entities.filter((e) => e.entityType === entityType);

    const limit = Math.min(Number(args.limit ?? 20), 100);

    // Cursor-based pagination (FR-065): cursor is the entity name.
    let startIdx = Number(args.offset ?? 0);
    if (args.cursor) {
      const cursorIdx = matching.findIndex((e) => e.id === String(args.cursor));
      startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
    }
    const slice = matching.slice(startIdx, startIdx + limit);
    const nextCursor = slice.length === limit && startIdx + limit < matching.length
      ? slice[slice.length - 1].id
      : null;

    return rpcOk(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          entity_type: entityType,
          items: slice.map((e) => ({
            id: e.id,
            name: e.name,
            description: e.description,
            fields: e.fields,
            sample_data: e.sampleData ?? null,
          })),
          total: matching.length,
          limit,
          cursor: args.cursor ?? null,
          next_cursor: nextCursor,
        }, null, 2),
      }],
    });
  }

  // ── search actions (live proxy via Playwright) ─────────────────────────────
  const actions = await getActionsBySite(site.id);
  const action = actions.find((a) => a.name === toolName && a.type === 'search');
  if (action) {
    return await executeSearchAction(id, site.url, action.targetUrl, args);
  }

  return rpcError(id, -32601, `Unknown tool: ${toolName}`);
}

async function executeSearchAction(
  id: JsonRpcRequest['id'],
  siteUrl: string,
  targetUrl: string | undefined,
  args: Record<string, unknown>
): Promise<JsonRpcResponse> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const url = targetUrl || siteUrl;
    const query = String(args.query ?? args.q ?? '');

    // Build URL with query param if it's a GET search
    const searchUrl = query
      ? `${url}${url.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}`
      : url;

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(500);

    const text = await page.evaluate(() => {
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
      return (clone.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    });

    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map((el) => ({
        text: (el.textContent ?? '').trim().slice(0, 200),
        href: (el as HTMLAnchorElement).href,
      }))
    );

    return rpcOk(id, {
      content: [{
        type: 'text',
        text: JSON.stringify({ query, url: page.url(), text_content: text, links }, null, 2),
      }],
    });
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

// ── resources/list ────────────────────────────────────────────────────────────
async function handleResourcesList(
  id: JsonRpcRequest['id'],
  slug: string
): Promise<JsonRpcResponse> {
  const spec = await getGeneratedSpec(await getSlugId(slug));
  if (!spec) return rpcError(id, -32602, `Site "${slug}" not ready.`);

  const manifest = spec.mcpManifest as MCPManifest;
  return rpcOk(id, { resources: manifest.resources });
}

// ── resources/read ────────────────────────────────────────────────────────────
async function handleResourcesRead(
  id: JsonRpcRequest['id'],
  slug: string,
  params: unknown
): Promise<JsonRpcResponse> {
  const p = params as { uri?: string };
  const uri = p?.uri;
  if (!uri) return rpcError(id, -32602, 'Missing required param: uri');

  const site = await getSiteBySlug(slug);
  if (!site) return rpcError(id, -32602, `Site not found: ${slug}`);

  // webbridge://{slug}/pages
  if (uri === `webbridge://${slug}/pages`) {
    const pages = await getPagesBySite(site.id);
    return rpcOk(id, {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(pages.map((p) => ({
          url: p.url, title: p.title, page_type: p.pageType, summary: p.summary,
        })), null, 2),
      }],
    });
  }

  // webbridge://{slug}/entities
  if (uri === `webbridge://${slug}/entities`) {
    const entities = await getEntitiesBySite(site.id);
    return rpcOk(id, {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(entities, null, 2),
      }],
    });
  }

  // webbridge://{slug}/page/{encoded-url}
  const pageMatch = uri.match(new RegExp(`^webbridge://${slug}/page/(.+)$`));
  if (pageMatch) {
    const pageUrl = decodeURIComponent(pageMatch[1]);
    const page = await getPageByUrl(site.id, pageUrl);
    if (!page) return rpcError(id, -32602, `Page not found: ${pageUrl}`);
    return rpcOk(id, {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: `Title: ${page.title}\nURL: ${page.url}\nType: ${page.pageType}\n\n${page.rawText}`,
      }],
    });
  }

  return rpcError(id, -32602, `Unknown resource URI: ${uri}`);
}

// ── Utility ───────────────────────────────────────────────────────────────────
async function getSlugId(slug: string): Promise<string> {
  const site = await getSiteBySlug(slug);
  return site?.id ?? '';
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /sites/:slug/agent.json — discovery manifest
router.get('/agent.json', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const spec = await getGeneratedSpec(await getSlugId(slug)).catch(() => null);
  if (!spec) {
    return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found or not ready.`, retryable: false });
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-WebBridge-Last-Crawled', (spec.agentJson as { last_crawled: string }).last_crawled ?? '');
  return res.json(spec.agentJson);
});

// GET /sites/:slug/openapi.json — OpenAPI spec
router.get('/openapi.json', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const spec = await getGeneratedSpec(await getSlugId(slug)).catch(() => null);
  if (!spec) {
    return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found or not ready.`, retryable: false });
  }
  res.setHeader('Content-Type', 'application/json');
  return res.json(spec.openapiSpec);
});

// POST /sites/:slug/mcp — JSON-RPC 2.0 MCP endpoint
router.post('/mcp', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const startedAt = Date.now();
  const body = req.body as JsonRpcRequest;
  let response: JsonRpcResponse;
  let toolName: string | undefined;

  try {
    if (!body || body.jsonrpc !== '2.0') {
      response = rpcError(null, -32600, 'Invalid JSON-RPC request. jsonrpc must be "2.0".');
      return res.status(400).json(response);
    }

    const { id, method, params } = body;
    toolName = method === 'tools/call' ? (params as { name?: string })?.name : undefined;

    switch (method) {
      case 'initialize':
        response = await handleInitialize(id, slug);
        break;
      case 'tools/list':
        response = await handleToolsList(id, slug);
        break;
      case 'tools/call':
        response = await handleToolsCall(id, slug, params);
        break;
      case 'resources/list':
        response = await handleResourcesList(id, slug);
        break;
      case 'resources/read':
        response = await handleResourcesRead(id, slug, params);
        break;
      default:
        response = rpcError(id ?? null, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error(`[MCP] Error handling ${slug}:`, msg);
    response = rpcError(body?.id ?? null, -32603, msg);
  }

  const durationMs = Date.now() - startedAt;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (site) {
    await logRequest({
      siteId: site.id,
      toolName,
      requestBody: body as unknown as object,
      responseStatus: 'error' in response ? 500 : 200,
      durationMs,
      errorMessage: 'error' in response ? response.error.message : undefined,
    }).catch(() => {});
  }

  const httpStatus = 'error' in response ? 400 : 200;
  res.setHeader('X-WebBridge-Last-Crawled', site?.lastCrawled?.toISOString() ?? '');
  return res.status(httpStatus).json(response);
});

// GET /sites/:slug/mcp — returns MCP manifest (GET convenience)
router.get('/mcp', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const spec = await getGeneratedSpec(await getSlugId(slug)).catch(() => null);
  if (!spec) {
    return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found or not ready.`, retryable: false });
  }
  res.setHeader('Content-Type', 'application/json');
  return res.json({
    message: 'Send POST requests with JSON-RPC 2.0 body to interact with this MCP endpoint.',
    mcp_endpoint: `${BASE_URL}/sites/${slug}/mcp`,
    manifest: spec.mcpManifest,
  });
});

// GET /sites/:slug/llms.txt — LLM-readable plain-text site summary (SRS 3.6)
// Follows the emerging llms.txt convention: https://llmstxt.org
// Public endpoint — no API key required (intended for LLM crawlers).
router.get('/llms.txt', async (req, res) => {
  const { slug } = req.params as { slug: string };
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) {
    return res.status(404).type('text/plain').send(`Site "${slug}" not found.`);
  }
  if (site.status !== 'ready') {
    return res.status(503).type('text/plain').send(`Site "${slug}" is not yet ready. Status: ${site.status}`);
  }

  const [pages, entities, actions] = await Promise.all([
    getPagesBySite(site.id),
    getEntitiesBySite(site.id),
    getActionsBySite(site.id),
  ]);

  const text = generateLlmsTxt(site, pages, entities, actions, BASE_URL);

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('X-WebBridge-Last-Crawled', site.lastCrawled?.toISOString() ?? '');
  return res.send(text);
});

export default router;
