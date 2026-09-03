import type { Page } from 'playwright';
import type { NavLink } from '../types';

export interface PageContent {
  title: string;
  textContent: string;
  links: NavLink[];
  forms: FormInfo[];
  metaDescription: string;
}

export interface FormInfo {
  action: string;
  method: string;
  fields: Array<{
    name: string;
    type: string;
    label: string;
    required: boolean;
    options?: string[];
  }>;
  submitLabel: string;
}

export async function extractPageContent(
  page: Page,
  pageUrl: string
): Promise<PageContent> {
  const baseOrigin = new URL(pageUrl).origin;

  const title = await page.title();

  const metaDescription = await page
    .locator('meta[name="description"]')
    .getAttribute('content')
    .catch(() => '')
    .then((v) => v ?? '');

  // Extract visible text — remove script/style noise
  const textContent = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, noscript, svg, iframe').forEach((el) =>
      el.remove()
    );
    return (clone.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  });

  // Extract all links
  const rawLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]')).map((el) => ({
      href: (el as HTMLAnchorElement).href,
      label: (el.textContent ?? '').trim().slice(0, 100),
    }));
  });

  const links: NavLink[] = rawLinks
    .filter((l) => l.href && (l.href.startsWith('http://') || l.href.startsWith('https://')))
    .map((l) => {
      let isExternal = true;
      try {
        isExternal = new URL(l.href).origin !== baseOrigin;
      } catch {
        // ignore malformed URLs
      }
      return {
        label: l.label || l.href,
        url: l.href,
        isExternal,
      };
    })
    // deduplicate by URL
    .filter((link, idx, arr) => arr.findIndex((l) => l.url === link.url) === idx);

  // Extract forms
  const forms = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('form')).map((form) => {
      const action = form.action || '';
      const method = (form.method || 'get').toUpperCase();

      const fields = Array.from(
        form.querySelectorAll('input, textarea, select')
      ).map((el) => {
        const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const name = input.name || input.id || '';
        const type = 'type' in input ? input.type : 'textarea';
        const required = (input as HTMLInputElement).required ?? false;

        // Attempt to find associated label
        let label = '';
        if (input.id) {
          const labelEl = document.querySelector(`label[for="${input.id}"]`);
          if (labelEl) label = (labelEl.textContent ?? '').trim();
        }
        if (!label && input.parentElement) {
          const parentLabel = input.parentElement.querySelector('label');
          if (parentLabel) label = (parentLabel.textContent ?? '').trim();
        }
        label = label || name;

        // Options for select elements
        let options: string[] | undefined;
        if (el.tagName === 'SELECT') {
          options = Array.from((el as HTMLSelectElement).options)
            .map((o) => o.value)
            .filter(Boolean)
            .slice(0, 20);
        }

        return { name, type, label, required, options };
      }).filter((f) => f.name && f.type !== 'hidden' && f.type !== 'submit');

      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      const submitLabel = submitBtn
        ? ((submitBtn.textContent ?? '') || (submitBtn as HTMLInputElement).value || 'Submit').trim()
        : 'Submit';

      return { action, method, fields, submitLabel };
    });
  });

  return { title, textContent, links, forms, metaDescription };
}
