import { Router } from 'express';
import {
  getSiteBySlug,
  createWebhook,
  getWebhooksBySite,
  getWebhookById,
  deleteWebhook,
  getWebhookDeliveries,
  writeAuditLog,
} from '../../db/queries';
import { requireApiKey } from '../middleware/auth';
import { attachJwt } from '../middleware/jwt';

const router = Router({ mergeParams: true });

const SUPPORTED_EVENTS = [
  'site.registered', 'site.deleted',
  'crawl.started', 'crawl.completed', 'crawl.failed',
];

// GET /api/sites/:slug/webhooks
router.get('/', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const hooks = await getWebhooksBySite(site.id);
  return res.json({
    webhooks: hooks.map((h) => ({
      id: h.id,
      url: h.url,
      events: h.events,
      isActive: h.isActive,
      lastTriggered: h.lastTriggered?.toISOString() ?? null,
      createdAt: h.createdAt.toISOString(),
    })),
    supported_events: SUPPORTED_EVENTS,
  });
});

// POST /api/sites/:slug/webhooks
router.post('/', requireApiKey, attachJwt, async (req, res) => {
  const { slug } = req.params;
  const { url, events, secret } = req.body as { url?: string; events?: string[]; secret?: string };

  if (!url) return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'url is required', retryable: false });
  if (!events || events.length === 0) return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'events array is required', retryable: false });

  const invalid = events.filter((e) => !SUPPORTED_EVENTS.includes(e));
  if (invalid.length > 0) {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: `Unsupported events: ${invalid.join(', ')}. Supported: ${SUPPORTED_EVENTS.join(', ')}`, retryable: false });
  }

  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const { id } = await createWebhook({ siteId: site.id, url, events, secret });

  await writeAuditLog({
    action: 'WEBHOOK_CREATED',
    resourceType: 'webhook',
    resourceId: id,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    newValues: { url, events },
    ipAddress: req.ip,
  });

  return res.status(201).json({ id, url, events, isActive: true });
});

// DELETE /api/sites/:slug/webhooks/:webhookId
router.delete('/:webhookId', requireApiKey, attachJwt, async (req, res) => {
  const { slug, webhookId } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  // Ownership check: verify the webhook belongs to this site (prevents IDOR)
  const webhook = await getWebhookById(webhookId).catch(() => null);
  if (!webhook || webhook.siteId !== site.id) {
    return res.status(403).json({ error_code: 'FORBIDDEN', message: 'Webhook not found for this site.', retryable: false });
  }

  await deleteWebhook(webhookId);

  await writeAuditLog({
    action: 'WEBHOOK_DELETED',
    resourceType: 'webhook',
    resourceId: webhookId,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    ipAddress: req.ip,
  });

  return res.json({ ok: true });
});

// GET /api/sites/:slug/webhooks/:webhookId/deliveries
router.get('/:webhookId/deliveries', requireApiKey, async (req, res) => {
  const { slug, webhookId } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  // Ownership check: verify the webhook belongs to this site (prevents IDOR)
  const webhook = await getWebhookById(webhookId).catch(() => null);
  if (!webhook || webhook.siteId !== site.id) {
    return res.status(403).json({ error_code: 'FORBIDDEN', message: 'Webhook not found for this site.', retryable: false });
  }

  const deliveries = await getWebhookDeliveries(webhookId);
  return res.json({ deliveries });
});

export default router;
