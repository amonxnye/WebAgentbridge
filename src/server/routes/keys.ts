import { Router } from 'express';
import {
  getSiteBySlug,
  createConsumerKey,
  getConsumerKeysBySite,
  getConsumerKeyById,
  revokeConsumerKey,
  writeAuditLog,
} from '../../db/queries';
import { requireApiKey } from '../middleware/auth';
import { attachJwt } from '../middleware/jwt';

const router = Router({ mergeParams: true });

// GET /api/sites/:slug/keys
router.get('/', requireApiKey, async (req, res) => {
  const { slug } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const keys = await getConsumerKeysBySite(site.id);
  return res.json({
    keys: keys.map((k) => ({
      id: k.id,
      label: k.label,
      isActive: k.isActive,
      lastUsed: k.lastUsed?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    })),
    total: keys.length,
  });
});

// POST /api/sites/:slug/keys
router.post('/', requireApiKey, attachJwt, async (req, res) => {
  const { slug } = req.params;
  const { label = 'Unnamed key' } = req.body as { label?: string };

  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  const { id, key } = await createConsumerKey(site.id, label);

  await writeAuditLog({
    action: 'KEY_CREATED',
    resourceType: 'consumer_key',
    resourceId: id,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    newValues: { label },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.status(201).json({
    id,
    key,  // returned ONCE — store it securely
    label,
    message: 'Store this key securely — it will not be shown again.',
  });
});

// DELETE /api/sites/:slug/keys/:keyId
router.delete('/:keyId', requireApiKey, attachJwt, async (req, res) => {
  const { slug, keyId } = req.params;
  const site = await getSiteBySlug(slug).catch(() => null);
  if (!site) return res.status(404).json({ error_code: 'NOT_FOUND', message: `Site "${slug}" not found.`, retryable: false });

  // Ownership check: verify the key belongs to this site (prevents IDOR)
  const key = await getConsumerKeyById(keyId).catch(() => null);
  if (!key || key.siteId !== site.id) {
    return res.status(403).json({ error_code: 'FORBIDDEN', message: 'Key not found for this site.', retryable: false });
  }

  await revokeConsumerKey(keyId);

  await writeAuditLog({
    action: 'KEY_REVOKED',
    resourceType: 'consumer_key',
    resourceId: keyId,
    siteId: site.id,
    userId: req.jwtUser?.sub,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({ ok: true, message: `Key "${keyId}" revoked.` });
});

export default router;
