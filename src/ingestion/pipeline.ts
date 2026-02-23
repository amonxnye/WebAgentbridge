import { WebCrawler } from '../crawler';
import { SemanticClassifier } from '../semantic/classifier';
import { generateOpenAPI } from '../generator/openapi';
import { generateMCPManifest } from '../generator/mcp-manifest';
import { generateAgentJson } from '../generator/agent-json';
import {
  getSiteById,
  updateSiteStatus,
  upsertPage,
  updatePageClassification,
  saveEntities,
  saveActions,
  getPagesBySite,
  getEntitiesBySite,
  getActionsBySite,
  saveGeneratedSpec,
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

  const crawler = new WebCrawler();
  const classifier = new SemanticClassifier();

  let pagesProcessed = 0;
  let entitiesFound = 0;
  let actionsFound = 0;

  try {
    await crawler.init();

    await crawler.crawl({
      site,
      onPage: async (rawPage) => {
        // 1. Persist the page (with placeholder pageType)
        const page = await upsertPage(rawPage);

        // 2. Classify with Claude
        console.log(`[Pipeline] Classifying: ${rawPage.url}`);

        // Re-use the page content that was already extracted during crawl
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
            classification.entities.map((e) => ({
              ...e,
              siteId,
              pageId: page.id,
            }))
          );
          entitiesFound += classification.entities.length;
        }

        // 5. Persist actions
        if (classification.actions.length > 0) {
          await saveActions(
            classification.actions.map((a) => ({
              ...a,
              siteId,
              pageId: page.id,
            }))
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

    // Refresh site to get updated lastCrawled
    const updatedSite: Site = { ...site, lastCrawled: new Date() };

    const openapiSpec = generateOpenAPI(updatedSite, pages, entities, actions);
    const mcpManifest = generateMCPManifest(updatedSite, pages, entities, actions);
    const agentJson = generateAgentJson(updatedSite, entities, actions);

    await saveGeneratedSpec({ siteId, openapiSpec, mcpManifest, agentJson });
    await updateSiteStatus(siteId, 'ready', new Date());

    const durationMs = Date.now() - startedAt;
    console.log(
      `[Pipeline] ✓ Ingestion complete in ${(durationMs / 1000).toFixed(1)}s — ` +
      `${pagesProcessed} pages, ${entitiesFound} entities, ${actionsFound} actions`
    );

    return { siteId, pagesProcessed, entitiesFound, actionsFound, durationMs };
  } catch (err) {
    console.error('[Pipeline] Ingestion failed:', err instanceof Error ? err.message : err);
    await updateSiteStatus(siteId, 'failed');
    throw err;
  } finally {
    await crawler.close();
  }
}
