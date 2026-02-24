import { chromium, Browser, BrowserContextOptions } from 'playwright';
import { extractPageContent } from './extractor';
import type { Site, CrawledPage } from '../types';

const CRAWL_DELAY_MS = parseInt(process.env.CRAWL_DELAY_MS ?? '500', 10);
const PAGE_TIMEOUT_MS = parseInt(process.env.CRAWL_PAGE_TIMEOUT_MS ?? '30000', 10);

export interface CrawlJob {
  site: Site;
  onPage: (page: Omit<CrawledPage, 'id'>) => Promise<void>;
  /** Extra HTTP headers to send on every request (e.g. API key auth). */
  extraHTTPHeaders?: Record<string, string>;
  /** Serialised Playwright storage state JSON (session cookies from login-form auth). */
  storageState?: string;
}

export { Browser };

export class WebCrawler {
  private browser: Browser | null = null;
  private visitedUrls = new Set<string>();

  async init(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    console.log('[Crawler] Browser launched.');
  }

  getBrowser(): Browser {
    if (!this.browser) throw new Error('Crawler not initialised — call init() first.');
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    console.log('[Crawler] Browser closed.');
  }

  async crawl(job: CrawlJob): Promise<{ pageCount: number }> {
    if (!this.browser) throw new Error('Crawler not initialised — call init() first.');

    const { site } = job;
    const baseUrl = new URL(site.url);
    const queue: Array<{ url: string; depth: number }> = [{ url: site.url, depth: 0 }];
    this.visitedUrls.clear();

    const disallowedPaths = site.respectRobotsTxt
      ? await this.fetchDisallowedPaths(baseUrl.origin)
      : [];

    let pageCount = 0;

    while (queue.length > 0) {
      const item = queue.shift()!;

      if (this.visitedUrls.has(item.url)) continue;
      if (item.depth > site.crawlDepth) continue;
      if (!this.isAllowedUrl(item.url, baseUrl, disallowedPaths, site)) continue;

      this.visitedUrls.add(item.url);
      console.log(`[Crawler] Fetching [depth=${item.depth}] ${item.url}`);

      const contextOptions: BrowserContextOptions = {
        userAgent: 'WebBridge-Crawler/1.0 (https://webbridge.io/bot)',
        ...(job.extraHTTPHeaders ? { extraHTTPHeaders: job.extraHTTPHeaders } : {}),
      };
      // Apply login-form session cookies if provided
      if (job.storageState) {
        (contextOptions as Record<string, unknown>).storageState = JSON.parse(job.storageState);
      }
      const context = await this.browser.newContext(contextOptions);
      const page = await context.newPage();

      try {
        await page.goto(item.url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
        // Allow JS to settle
        await page.waitForTimeout(500);

        const content = await extractPageContent(page, item.url);

        const crawledPage: Omit<CrawledPage, 'id'> = {
          siteId: site.id,
          url: item.url,
          title: content.title,
          pageType: 'other',          // overwritten by classifier
          summary: content.metaDescription || content.textContent.slice(0, 300),
          rawText: content.textContent,
          navLinks: content.links.filter((l) => !l.isExternal),
          crawledAt: new Date(),
        };

        await job.onPage(crawledPage);
        pageCount++;

        // Enqueue discovered internal links
        for (const link of content.links) {
          if (
            !link.isExternal &&
            !this.visitedUrls.has(link.url) &&
            !queue.some((q) => q.url === link.url)
          ) {
            queue.push({ url: link.url, depth: item.depth + 1 });
          }
        }

        if (CRAWL_DELAY_MS > 0) {
          await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[Crawler] Failed to crawl ${item.url}: ${msg}`);
      } finally {
        await page.close();
        await context.close();
      }
    }

    console.log(`[Crawler] Crawl complete — ${pageCount} pages processed.`);
    return { pageCount };
  }

  private isAllowedUrl(
    url: string,
    baseUrl: URL,
    disallowedPaths: string[],
    site: Site
  ): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }

    if (parsed.hostname !== baseUrl.hostname) return false;

    // Excluded paths defined by site owner
    if (site.excludedPaths) {
      for (const p of site.excludedPaths) {
        if (parsed.pathname.startsWith(p)) return false;
      }
    }

    // Allowed paths filter (if specified, only crawl matching paths)
    if (site.allowedPaths && site.allowedPaths.length > 0) {
      const allowed = site.allowedPaths.some((p) => parsed.pathname.startsWith(p));
      if (!allowed) return false;
    }

    // robots.txt
    for (const p of disallowedPaths) {
      if (p && parsed.pathname.startsWith(p)) return false;
    }

    return true;
  }

  private async fetchDisallowedPaths(origin: string): Promise<string[]> {
    if (!this.browser) return [];
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const disallowed: string[] = [];
    try {
      const res = await page.goto(`${origin}/robots.txt`, { timeout: 5000 });
      if (res?.ok()) {
        const text = await page.evaluate(() => document.body.innerText ?? '');
        let inUserAgentAll = false;
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (/^user-agent:/i.test(trimmed)) {
            inUserAgentAll = /\*/.test(trimmed);
          }
          if (inUserAgentAll && /^disallow:/i.test(trimmed)) {
            const path = trimmed.split(':')[1]?.trim();
            if (path) disallowed.push(path);
          }
        }
      }
    } catch {
      // robots.txt is optional
    } finally {
      await page.close();
      await context.close();
    }
    console.log(`[Crawler] robots.txt: ${disallowed.length} disallowed paths.`);
    return disallowed;
  }
}
