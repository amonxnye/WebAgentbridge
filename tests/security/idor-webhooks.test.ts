/**
 * BUG: IDOR — webhook deliveries endpoint has no ownership check
 *
 * FOUND: src/server/routes/webhooks.ts lines 92-96
 *   router.get('/:webhookId/deliveries', requireApiKey, async (req, res) => {
 *     const { webhookId } = req.params;
 *     const deliveries = await getWebhookDeliveries(webhookId); // No ownership check!
 *     return res.json({ deliveries });
 *   });
 *
 * An attacker with a valid API key can enumerate ANY webhook's delivery history
 * by guessing or brute-forcing UUIDs.
 *
 * Similarly: DELETE /:webhookId never checks the webhook belongs to the site in the URL.
 *
 * FIX: Verify the webhook's site_id matches the site resolved from :slug before returning data.
 */

import express from 'express';
import request from 'supertest';

// ── mock DB queries ───────────────────────────────────────────────────────────
jest.mock('../../src/db/queries', () => ({
  getSiteBySlug: jest.fn(),
  createWebhook: jest.fn(),
  getWebhooksBySite: jest.fn(),
  deleteWebhook: jest.fn(),
  getWebhookDeliveries: jest.fn(),
  getWebhookById: jest.fn(),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/server/middleware/auth', () => ({
  requireApiKey: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/server/middleware/jwt', () => ({
  attachJwt: (_req: any, _res: any, next: any) => next(),
}));

import {
  getSiteBySlug,
  getWebhookDeliveries,
  getWebhookById,
} from '../../src/db/queries';

// Build app once — no jest.resetModules() needed
import webhooksRouter from '../../src/server/routes/webhooks';
const app = express();
app.use(express.json());
app.use('/api/sites/:slug/webhooks', webhooksRouter);

describe('IDOR: webhook deliveries ownership check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when the slug does not exist', async () => {
    (getSiteBySlug as jest.Mock).mockResolvedValue(null);
    const res = await request(app)
      .get('/api/sites/nonexistent/webhooks/wh-uuid-123/deliveries');
    expect(res.status).toBe(404);
  });

  it('returns 403 when the webhookId belongs to a different site (IDOR)', async () => {
    // Site A is resolved from the slug
    (getSiteBySlug as jest.Mock).mockResolvedValue({ id: 'site-A', slug: 'site-a' });
    // But the webhook belongs to site B
    (getWebhookById as jest.Mock).mockResolvedValue({ id: 'wh-uuid-123', siteId: 'site-B' });

    const res = await request(app)
      .get('/api/sites/site-a/webhooks/wh-uuid-123/deliveries');

    // After the fix, must be 403 NOT 200
    expect(res.status).toBe(403);
    expect(res.body.error_code).toBe('FORBIDDEN');
    // Deliveries must NOT be returned
    expect(res.body.deliveries).toBeUndefined();
    expect(getWebhookDeliveries).not.toHaveBeenCalled();
  });

  it('returns deliveries when webhook belongs to the correct site', async () => {
    (getSiteBySlug as jest.Mock).mockResolvedValue({ id: 'site-A', slug: 'site-a' });
    (getWebhookById as jest.Mock).mockResolvedValue({ id: 'wh-uuid-123', siteId: 'site-A' });
    (getWebhookDeliveries as jest.Mock).mockResolvedValue([{ id: 'd1', event_type: 'crawl.completed' }]);

    const res = await request(app)
      .get('/api/sites/site-a/webhooks/wh-uuid-123/deliveries');
    expect(res.status).toBe(200);
    expect(res.body.deliveries).toHaveLength(1);
  });
});
