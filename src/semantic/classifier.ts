import Anthropic from '@anthropic-ai/sdk';
import type { ClassificationResult, PageType } from '../types';
import type { PageContent } from '../crawler/extractor';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const CLASSIFICATION_SYSTEM = `You are a semantic web analyst. Given a webpage's URL, title, and text content, you extract structured information about what the page contains and what a user can do on it.

Respond ONLY with a valid JSON object — no markdown, no explanation, just the JSON.`;

const CLASSIFICATION_PROMPT = (url: string, title: string, content: string, forms: string) => `
URL: ${url}
Title: ${title}

Content (truncated):
${content.slice(0, 3000)}

Forms detected:
${forms}

Analyse this page and return a JSON object with this exact structure:
{
  "pageType": "<one of: article | product_listing | dashboard | form | navigation | landing | search | documentation | other>",
  "summary": "<1-2 sentence description of what this page is and does>",
  "entities": [
    {
      "name": "<entity name, e.g. Product, Article, Job Listing>",
      "entityType": "<snake_case type, e.g. product, article, job_listing>",
      "description": "<what this entity represents>",
      "fields": [
        {
          "name": "<field name in snake_case>",
          "type": "<one of: string | number | boolean | date | url | email | array>",
          "description": "<what this field contains>",
          "example": "<example value or null>",
          "required": true
        }
      ]
    }
  ],
  "actions": [
    {
      "name": "<action name in snake_case, e.g. search_products, submit_contact_form>",
      "type": "<one of: search | form_submit | navigate | filter | pagination>",
      "description": "<what this action does>",
      "inputs": [
        {
          "name": "<input name>",
          "type": "<one of: text | email | password | select | checkbox | number | textarea>",
          "required": true,
          "description": "<what to enter>",
          "options": null
        }
      ],
      "targetUrl": "<form action URL or null>",
      "method": "<GET or POST or null>"
    }
  ]
}

Rules:
- Only include entities if real structured data is visible (not generic navigation or footer links).
- Only include actions for forms/search bars/filters that are actually present on the page.
- If no entities are present, return an empty array.
- If no actions are present, return an empty array.
- Keep field names concise and in snake_case.
`;

const VALID_PAGE_TYPES: PageType[] = [
  'article', 'product_listing', 'dashboard', 'form', 'navigation',
  'landing', 'search', 'documentation', 'other',
];

function isValidPageType(v: unknown): v is PageType {
  return typeof v === 'string' && VALID_PAGE_TYPES.includes(v as PageType);
}

export class SemanticClassifier {
  async classify(
    url: string,
    content: PageContent
  ): Promise<ClassificationResult> {
    const formsJson = content.forms.length > 0
      ? JSON.stringify(content.forms, null, 2)
      : 'No forms detected.';

    const prompt = CLASSIFICATION_PROMPT(url, content.title, content.textContent, formsJson);

    let raw = '';
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: CLASSIFICATION_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      });

      const block = message.content[0];
      if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
      raw = block.text.trim();

      // Strip markdown code fences if present
      const jsonMatch = raw.match(/```(?:json)?\n?([\s\S]*?)\n?```/) ?? null;
      const jsonStr = jsonMatch ? jsonMatch[1] : raw;

      const parsed = JSON.parse(jsonStr) as ClassificationResult;

      // Validate and sanitise
      if (!isValidPageType(parsed.pageType)) parsed.pageType = 'other';
      if (typeof parsed.summary !== 'string') parsed.summary = '';
      if (!Array.isArray(parsed.entities)) parsed.entities = [];
      if (!Array.isArray(parsed.actions)) parsed.actions = [];

      return parsed;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Classifier] Classification failed for ${url}: ${msg}`);
      // Return a safe fallback
      return {
        pageType: 'other',
        summary: content.metaDescription || content.title || 'Page content',
        entities: [],
        actions: [],
      };
    }
  }
}
