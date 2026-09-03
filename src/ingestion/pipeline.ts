import { WebCrawler } from '../crawler';
import { SemanticClassifier } from '../semantic/classifier';
import { authenticateSite } from '../auth/site-auth';
import { dispatch } from '../webhooks/dispatcher';
import { generateOpenAPI } from '../generator/openapi';
import { generateMCPManifest } from '../generator/mcp-manifest';
import { generateAgentJson } from '../generator/agent-json';
import {
  getSiteById,
  updateSiteStatus,
  updateSiteLastCrawlError,
  upsertPage,
  updatePageClassification,
  saveEntities,
  saveActions,
  getPagesBySite,
  getEntitiesBySite,
  getActionsBySite,
  saveGeneratedSpec,
  writeAuditLog,
  clearRawContent,
} from '../db/queries';
import type { Site } from '../types';

export interface IngestionResult {
  siteId: string;
  pagesProcessed: number;
  entitiesFound: number;
  actionsFound: number;
  durationMs: number;
}

export async function runIngestion(siteId: string): Promise<IngestionResult> {
  const startedAt = Date.now();

  const site = await getSiteById(siteId);
  if (!site) throw new Error(`Site not found: ${siteId}`);

  console.log(`\n[Pipeline] Starting ingestion for "${site.name}" (${site.url})`);
  await updateSiteStatus(siteId, 'crawling');
  await updateSiteLastCrawlError(siteId, null);

  await dispatch(siteId, 'crawl.started', { site_url: site.url });
  await writeAuditLog({ action: 'CRAWL_STARTED', resourceType: 'site', resourceId: siteId, siteId });

  const crawler = new WebCrawler();
  const classifier = new SemanticClassifier();

  let pagesProcessed = 0;
  let entitiesFound = 0;
  let actionsFound = 0;

  try {
    await crawler.init();

    // Authenticate with the site if credentials are configured
    const authCtx = await authenticateSite(site, crawler.getBrowser());

    await crawler.crawl({
      site,
      extraHTTPHeaders: authCtx.headers,
      storageState: authCtx.storageState,
      onPage: async (rawPage) => {
        // 1. Persist the page (with placeholder pageType)
        const page = await upsertPage(rawPage);

        // 2. Classify with Claude
        console.log(`[Pipeline] Classifying: ${rawPage.url}`);
        const classification = await classifier.classify(rawPage.url, {
          title: rawPage.title,
          textContent: rawPage.rawText,
          links: rawPage.navLinks,
          forms: [],
          metaDescription: rawPage.summary,
        });

        // 3. Update page with classification
        await updatePageClassification(page.id, classification.pageType, classification.summary);

        // 4. Persist entities
        if (classification.entities.length > 0) {
          await saveEntities(
            classification.entities.map((e) => ({ ...e, siteId, pageId: page.id }))
          );
          entitiesFound += classification.entities.length;
        }

        // 5. Persist actions
        if (classification.actions.length > 0) {
          await saveActions(
            classification.actions.map((a) => ({ ...a, siteId, pageId: page.id }))
          );
          actionsFound += classification.actions.length;
        }

        pagesProcessed++;
        console.log(
          `[Pipeline] ✓ ${rawPage.url} → ${classification.pageType} ` +
          `(${classification.entities.length} entities, ${classification.actions.length} actions)`
        );
      },
    });

    // 6. Generate specs from aggregated model
    console.log('[Pipeline] Generating API specs...');
    const [pages, entities, actions] = await Promise.all([
      getPagesBySite(siteId),
      getEntitiesBySite(siteId),
      getActionsBySite(siteId),
    ]);

    const updatedSite: Site = { ...site, lastCrawled: new Date() };
    const openapiSpec = generateOpenAPI(updatedSite, pages, entities, actions);
    const mcpManifest = generateMCPManifest(updatedSite, pages, entities, actions);
    const agentJson = generateAgentJson(updatedSite, entities, actions);

    await saveGeneratedSpec({ siteId, openapiSpec, mcpManifest, agentJson });
    await updateSiteStatus(siteId, 'ready', new Date());

    // FR-064: Purge raw crawl content now that the semantic model is complete.
    // Raw HTML/text is only needed during ingestion; the generated spec is the
    // retained artefact. Set PURGE_RAW_CONTENT=false to disable (e.g. for debugging).
    if (process.env.PURGE_RAW_CONTENT !== 'false') {
      const purged = await clearRawContent(siteId).catch(() => 0);
      if (purged > 0) {
        console.log(`[Pipeline] Purged raw_text from ${purged} pages (FR-064 compliance).`);
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(
      `[Pipeline] ✓ Ingestion complete in ${(durationMs / 1000).toFixed(1)}s — ` +
      `${pagesProcessed} pages, ${entitiesFound} entities, ${actionsFound} actions`
    );

    await dispatch(siteId, 'crawl.completed', {
      pages_processed: pagesProcessed,
      entities_found: entitiesFound,
      actions_found: actionsFound,
      duration_ms: durationMs,
    });
    await writeAuditLog({
      action: 'CRAWL_COMPLETED',
      resourceType: 'site',
      resourceId: siteId,
      siteId,
      newValues: { pagesProcessed, entitiesFound, actionsFound, durationMs },
    });

    return { siteId, pagesProcessed, entitiesFound, actionsFound, durationMs };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[Pipeline] Ingestion failed:', errorMsg);
    await updateSiteStatus(siteId, 'failed');
    await updateSiteLastCrawlError(siteId, errorMsg);
    await dispatch(siteId, 'crawl.failed', { error: errorMsg }).catch(() => {});
    await writeAuditLog({
      action: 'CRAWL_FAILED',
      resourceType: 'site',
      resourceId: siteId,
      siteId,
      newValues: { error: errorMsg },
    });
    throw err;
  } finally {
    await crawler.close();
  }
}
