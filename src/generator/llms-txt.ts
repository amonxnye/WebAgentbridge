/**
 * Generates an llms.txt document for a site.
 *
 * llms.txt is an emerging convention (analogous to robots.txt) that gives LLMs
 * a plain-text summary of a site's structure. WebBridge auto-generates it from
 * the semantic model so site owners get discoverability in LLM developer tools
 * for free.
 *
 * Reference: https://llmstxt.org  (SRS Section 3.6 / Open Question #5)
 */
import type { Site, CrawledPage, Entity, Action } from '../types';

export function generateLlmsTxt(
  site: Site,
  pages: CrawledPage[],
  entities: Entity[],
  actions: Action[],
  baseUrl: string
): string {
  const lines: string[] = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  lines.push(`# ${site.name}`);
  lines.push('');
  if (site.description) {
    lines.push(`> ${site.description}`);
    lines.push('');
  }

  lines.push(`- **URL**: ${site.url}`);
  lines.push(`- **MCP Endpoint**: ${baseUrl}/sites/${site.slug}/mcp`);
  lines.push(`- **OpenAPI Spec**: ${baseUrl}/sites/${site.slug}/openapi.json`);
  lines.push(`- **agent.json**: ${baseUrl}/sites/${site.slug}/agent.json`);
  if (site.lastCrawled) {
    lines.push(`- **Last Crawled**: ${site.lastCrawled.toISOString()}`);
  }
  lines.push('');

  // ── Entity types ───────────────────────────────────────────────────────────
  const uniqueEntityTypes = [...new Set(entities.map((e) => e.entityType))];
  if (uniqueEntityTypes.length > 0) {
    lines.push('## Data Models');
    lines.push('');
    for (const entityType of uniqueEntityTypes) {
      const typeEntities = entities.filter((e) => e.entityType === entityType);
      const representative = typeEntities[0];
      lines.push(`### ${entityType}`);
      if (representative.description) {
        lines.push('');
        lines.push(representative.description);
      }
      if (representative.fields && representative.fields.length > 0) {
        lines.push('');
        lines.push('Fields:');
        for (const f of representative.fields) {
          const required = f.required ? ' *(required)*' : '';
          lines.push(`- \`${f.name}\` (${f.type})${required}${f.description ? ': ' + f.description : ''}`);
        }
      }
      lines.push('');
    }
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  if (actions.length > 0) {
    lines.push('## Available Actions');
    lines.push('');
    for (const action of actions) {
      lines.push(`### ${action.name}`);
      lines.push('');
      lines.push(action.description || `Performs a ${action.type} operation.`);
      if (action.inputs && action.inputs.length > 0) {
        lines.push('');
        lines.push('Inputs:');
        for (const input of action.inputs) {
          const req = input.required ? ' *(required)*' : '';
          lines.push(`- \`${input.name}\` (${input.type})${req}${input.description ? ': ' + input.description : ''}`);
        }
      }
      if (action.targetUrl) {
        lines.push('');
        lines.push(`Endpoint: \`${action.method ?? 'GET'} ${action.targetUrl}\``);
      }
      lines.push('');
    }
  }

  // ── Pages ──────────────────────────────────────────────────────────────────
  if (pages.length > 0) {
    lines.push('## Crawled Pages');
    lines.push('');
    // Group by page type
    const byType: Record<string, CrawledPage[]> = {};
    for (const p of pages) {
      (byType[p.pageType] ??= []).push(p);
    }
    for (const [type, typePages] of Object.entries(byType)) {
      lines.push(`### ${type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Pages`);
      lines.push('');
      for (const p of typePages.slice(0, 10)) {
        lines.push(`- [${p.title || p.url}](${p.url})${p.summary ? ': ' + p.summary : ''}`);
      }
      if (typePages.length > 10) {
        lines.push(`- *(${typePages.length - 10} more ${type} pages)*`);
      }
      lines.push('');
    }
  }

  // ── Usage instructions for LLMs ────────────────────────────────────────────
  lines.push('## Using This Site via MCP');
  lines.push('');
  lines.push('This site is available as a structured MCP (Model Context Protocol) endpoint.');
  lines.push('To interact with it programmatically:');
  lines.push('');
  lines.push('```');
  lines.push(`POST ${baseUrl}/sites/${site.slug}/mcp`);
  lines.push('Content-Type: application/json');
  lines.push('Authorization: Bearer <api-key>');
  lines.push('');
  lines.push('{ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }');
  lines.push('```');
  lines.push('');
  lines.push(`See the full tool list at: \`GET ${baseUrl}/sites/${site.slug}/mcp\``);
  lines.push('');

  return lines.join('\n');
}
