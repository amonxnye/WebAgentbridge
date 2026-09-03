import type { Site, CrawledPage, Entity, Action, EntityField } from '../types';

const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

function fieldTypeToOpenAPI(type: EntityField['type']): { type: string; format?: string } {
  switch (type) {
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'date': return { type: 'string', format: 'date-time' };
    case 'url': return { type: 'string', format: 'uri' };
    case 'email': return { type: 'string', format: 'email' };
    case 'array': return { type: 'array' };
    default: return { type: 'string' };
  }
}

export function generateOpenAPI(
  site: Site,
  pages: CrawledPage[],
  entities: Entity[],
  actions: Action[]
): object {
  const mcpBase = `${BASE_URL}/sites/${site.slug}/mcp`;

  // Deduplicate entity schemas by entityType
  const entityTypeMap = new Map<string, Entity>();
  for (const e of entities) {
    if (!entityTypeMap.has(e.entityType)) {
      entityTypeMap.set(e.entityType, e);
    }
  }

  // Build component schemas
  const schemas: Record<string, object> = {};

  // Standard error schema
  schemas['Error'] = {
    type: 'object',
    properties: {
      error_code: { type: 'string' },
      message: { type: 'string' },
      retryable: { type: 'boolean' },
    },
    required: ['error_code', 'message', 'retryable'],
  };

  // Page schema
  schemas['Page'] = {
    type: 'object',
    properties: {
      url: { type: 'string', format: 'uri' },
      title: { type: 'string' },
      page_type: { type: 'string' },
      summary: { type: 'string' },
      last_crawled: { type: 'string', format: 'date-time' },
    },
    required: ['url', 'title', 'page_type'],
  };

  // Entity schemas
  for (const [entityType, entity] of entityTypeMap) {
    const schemaName = entity.name.replace(/\s+/g, '');
    const properties: Record<string, object> = {};
    const required: string[] = [];

    for (const field of entity.fields) {
      properties[field.name] = {
        ...fieldTypeToOpenAPI(field.type),
        description: field.description,
        ...(field.example ? { example: field.example } : {}),
      };
      if (field.required) required.push(field.name);
    }

    schemas[schemaName] = {
      type: 'object',
      description: entity.description,
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // Build paths
  const paths: Record<string, object> = {};

  // GET /pages — list all crawled pages
  paths['/pages'] = {
    get: {
      operationId: 'listPages',
      summary: 'List all crawled pages',
      tags: ['Navigation'],
      responses: {
        '200': {
          description: 'List of pages',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  pages: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Page' },
                  },
                  total: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
  };

  // GET /pages/content — get content of a specific page
  paths['/pages/content'] = {
    get: {
      operationId: 'getPageContent',
      summary: 'Get structured content of a specific page',
      tags: ['Navigation'],
      parameters: [
        {
          name: 'url',
          in: 'query',
          required: true,
          schema: { type: 'string', format: 'uri' },
          description: 'URL of the page to retrieve',
        },
      ],
      responses: {
        '200': {
          description: 'Page content',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  title: { type: 'string' },
                  summary: { type: 'string' },
                  text_content: { type: 'string' },
                  page_type: { type: 'string' },
                },
              },
            },
          },
        },
        '404': {
          description: 'Page not found in crawl snapshot',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
    },
  };

  // Entity listing endpoints
  for (const [entityType, entity] of entityTypeMap) {
    const schemaName = entity.name.replace(/\s+/g, '');
    const path = `/entities/${entityType}`;
    paths[path] = {
      get: {
        operationId: `list_${entityType}`,
        summary: `List ${entity.name} entities`,
        description: entity.description,
        tags: ['Entities'],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: `List of ${entity.name}`,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: `#/components/schemas/${schemaName}` },
                    },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  // Action endpoints
  const searchActions = actions.filter((a) => a.type === 'search');
  for (const action of searchActions) {
    const path = `/actions/${action.name}`;
    const parameters = action.inputs.map((inp) => ({
      name: inp.name,
      in: 'query',
      required: inp.required,
      schema: { type: inp.type === 'number' ? 'number' : 'string' },
      description: inp.description,
    }));
    paths[path] = {
      get: {
        operationId: action.name,
        summary: action.description,
        tags: ['Actions'],
        parameters,
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: { type: 'array', items: { type: 'object' } },
                    total: { type: 'integer' },
                    query: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${site.name} — WebBridge API`,
      description: site.description,
      version: '1.0.0',
      'x-webbridge-site-slug': site.slug,
      'x-webbridge-last-crawled': site.lastCrawled?.toISOString() ?? null,
    },
    servers: [
      { url: mcpBase, description: 'WebBridge MCP endpoint' },
    ],
    paths,
    components: { schemas },
    security: [{ ApiKeyAuth: [] }],
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    },
    tags: [
      { name: 'Navigation', description: 'Browse crawled pages' },
      { name: 'Entities', description: 'Query structured data' },
      { name: 'Actions', description: 'Execute site actions' },
    ],
  };
}
