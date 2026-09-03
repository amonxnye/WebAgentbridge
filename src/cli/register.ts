#!/usr/bin/env ts-node
import dotenv from 'dotenv';
dotenv.config();

import { Command } from 'commander';
import slugify from 'slugify';
import { createSite, getSiteBySlug } from '../db/queries';
import { runIngestion } from '../ingestion/pipeline';
import { enqueueCrawl } from '../queue/jobs';
import type { Site } from '../types';

const BASE_URL = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

const program = new Command();

program
  .name('webbridge-register')
  .description('Register a website with WebBridge and run ingestion')
  .requiredOption('-u, --url <url>', 'URL of the website to register')
  .option('-n, --name <name>', 'Display name for the site (defaults to hostname)')
  .option('-d, --description <desc>', 'Short description of the site', '')
  .option('--depth <depth>', 'Crawl depth (default: 3)', '3')
  .option('--private', 'Mark site as private (not listed in registry)')
  .option('--queue', 'Enqueue job via BullMQ instead of running inline (requires Redis)')
  .option('--slug <slug>', 'Override auto-generated slug')
  .parse(process.argv);

const opts = program.opts<{
  url: string;
  name?: string;
  description: string;
  depth: string;
  private?: boolean;
  queue?: boolean;
  slug?: string;
}>();

async function main(): Promise<void> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.url);
  } catch {
    console.error(`✗ Invalid URL: ${opts.url}`);
    process.exit(1);
  }

  const hostname = parsedUrl.hostname;
  const siteName = opts.name ?? hostname;
  const autoSlug = slugify(hostname, { lower: true, strict: true });
  const slug = opts.slug ?? autoSlug;
  const crawlDepth = Math.max(1, Math.min(10, parseInt(opts.depth, 10)));

  console.log(`\nWebBridge Site Registration`);
  console.log(`─────────────────────────────`);
  console.log(`  URL:         ${opts.url}`);
  console.log(`  Name:        ${siteName}`);
  console.log(`  Slug:        ${slug}`);
  console.log(`  Crawl depth: ${crawlDepth}`);
  console.log(`  Visibility:  ${opts.private ? 'private' : 'public'}`);
  console.log(`  Mode:        ${opts.queue ? 'queued (BullMQ)' : 'inline'}\n`);

  // Check for existing site
  const existing = await getSiteBySlug(slug);
  let site: Site;

  if (existing) {
    console.log(`! Site with slug "${slug}" already exists (status: ${existing.status}).`);
    console.log(`  Using existing registration — re-running ingestion.\n`);
    site = existing;
  } else {
    site = await createSite({
      slug,
      url: opts.url,
      name: siteName,
      description: opts.description,
      crawlDepth,
      isPublic: !opts.private,
    });
    console.log(`✓ Site registered with id: ${site.id}`);
  }

  if (opts.queue) {
    const jobId = await enqueueCrawl({
      siteId: site.id,
      siteSlug: site.slug,
      siteUrl: site.url,
    });
    console.log(`✓ Crawl job enqueued (job id: ${jobId})`);
    console.log(`  Run 'npm run worker' to process the job.\n`);
  } else {
    console.log(`Starting inline ingestion...\n`);
    const result = await runIngestion(site.id);
    console.log(`\n─────────────────────────────`);
    console.log(`✓ Ingestion complete!`);
    console.log(`  Pages processed:  ${result.pagesProcessed}`);
    console.log(`  Entities found:   ${result.entitiesFound}`);
    console.log(`  Actions found:    ${result.actionsFound}`);
    console.log(`  Duration:         ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`\nEndpoints:`);
    console.log(`  MCP endpoint:     POST ${BASE_URL}/sites/${slug}/mcp`);
    console.log(`  agent.json:       GET  ${BASE_URL}/sites/${slug}/agent.json`);
    console.log(`  OpenAPI spec:     GET  ${BASE_URL}/sites/${slug}/openapi.json`);
    console.log(`  Registry:         GET  ${BASE_URL}/registry\n`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('\n✗ Registration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
