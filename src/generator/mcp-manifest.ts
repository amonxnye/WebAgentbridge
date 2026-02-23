import type { Site, CrawledPage, Entity, Action, MCPTool, MCPResource, MCPManifest } from '../types';

export function generateMCPManifest(
  site: Site,
  pages: CrawledPage[],
  entities: Entity[],
  actions: Action[]
): MCPManifest {
  const tools: MCPTool[] = [];
  const resources: MCPResource[] = [];

  // ── Tool: list_pages ─────────────────────────────────────────────────────────
  tools.push({
    name: 'list_pages',
    description: `List all pages crawled from ${site.name}. Returns URLs, titles, and page types.`,
    inputSchema: {
      type: 'object',
      properties: {
        page_type: {
          type: 'string',
          description: 'Filter by page type',
          enum: ['article', 'product_listing', 'dashboard', 'form', 'navigation', 'landing', 'search', 'documentation', 'other'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of pages to return (default 20, max 100)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default 0)',
        },
      },
      required: [],
    },
  });

  // ── Tool: get_page ───────────────────────────────────────────────────────────
  tools.push({
    name: 'get_page',
    description: `Retrieve the full text content and metadata of a specific page from ${site.name}.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the page to retrieve. Must be a URL previously crawled from this site.',
        },
      },
      required: ['url'],
    },
  });

  // ── Tool: get_site_info ──────────────────────────────────────────────────────
  tools.push({
    name: 'get_site_info',
    description: `Get metadata about ${site.name}: description, available capabilities, and crawl information.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  });

  // ── Entity tools ─────────────────────────────────────────────────────────────
  const entityTypeMap = new Map<string, Entity>();
  for (const e of entities) {
    if (!entityTypeMap.has(e.entityType)) {
      entityTypeMap.set(e.entityType, e);
    }
  }

  for (const [entityType, entity] of entityTypeMap) {
    tools.push({
      name: `list_${entityType}`,
      description: `List ${entity.name} entities found on ${site.name}. ${entity.description}`,
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of items to return (default 20, max 100)',
          },
          offset: {
            type: 'number',
            description: 'Pagination offset (default 0)',
          },
        },
        required: [],
      },
    });
  }

  // ── Action tools ─────────────────────────────────────────────────────────────
  const searchActions = actions.filter((a) => a.type === 'search');
  for (const action of searchActions) {
    const properties: MCPTool['inputSchema']['properties'] = {};
    const required: string[] = [];

    for (const inp of action.inputs) {
      properties[inp.name] = {
        type: inp.type === 'number' ? 'number' : 'string',
        description: inp.description,
        ...(inp.options ? { enum: inp.options } : {}),
      };
      if (inp.required) required.push(inp.name);
    }

    tools.push({
      name: action.name,
      description: `${action.description} (live search against ${site.name})`,
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
    });
  }

  // ── Resources ────────────────────────────────────────────────────────────────
  resources.push({
    uri: `webbridge://${site.slug}/pages`,
    name: 'Pages',
    description: `All pages crawled from ${site.name}`,
    mimeType: 'application/json',
  });

  for (const page of pages.slice(0, 50)) {
    const encoded = encodeURIComponent(page.url);
    resources.push({
      uri: `webbridge://${site.slug}/page/${encoded}`,
      name: page.title || page.url,
      description: page.summary,
      mimeType: 'text/plain',
    });
  }

  if (entityTypeMap.size > 0) {
    resources.push({
      uri: `webbridge://${site.slug}/entities`,
      name: 'Entities',
      description: `Structured entities extracted from ${site.name}`,
      mimeType: 'application/json',
    });
  }

  return {
    name: site.name,
    version: '1.0',
    description: site.description,
    tools,
    resources,
  };
}
