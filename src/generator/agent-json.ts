import type { Site, Entity, Action, AgentJson } from '../types';

const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

export function generateAgentJson(
  site: Site,
  entities: Entity[],
  actions: Action[]
): AgentJson {
  const capabilities: string[] = ['read_content', 'list_pages'];

  const hasSearch = actions.some((a) => a.type === 'search');
  const hasForm = actions.some((a) => a.type === 'form_submit');
  const hasEntityData = entities.length > 0;

  if (hasSearch) capabilities.push('search');
  if (hasForm) capabilities.push('form_submit');
  if (hasEntityData) capabilities.push('structured_data');
  if (site.authType !== 'none') capabilities.push('auth_required');

  return {
    schema_version: '1.0',
    name: site.name,
    description: site.description || `WebBridge MCP endpoint for ${site.name}`,
    mcp_endpoint: `${BASE_URL}/sites/${site.slug}/mcp`,
    capabilities,
    auth: {
      type: 'api_key',
      scopes: ['read'],
    },
    last_crawled: site.lastCrawled?.toISOString() ?? null,
  };
}
