import { Router } from 'express';
import { getAuditLogs } from '../../db/queries';
import { requireApiKey } from '../middleware/auth';

const router = Router();

// GET /api/audit?siteId=&action=&limit=50&offset=0
router.get('/', requireApiKey, async (req, res) => {
  const {
    siteId, orgId, userId, action,
    limit = '50', offset = '0',
  } = req.query as Record<string, string | undefined>;

  try {
    const logs = await getAuditLogs({
      siteId,
      orgId,
      userId,
      action,
      limit: Math.min(200, parseInt(limit, 10)),
      offset: parseInt(offset, 10),
    });

    return res.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        siteId: l.siteId,
        userId: l.userId,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt.toISOString(),
      })),
      total: logs.length,
    });
  } catch (err) {
    console.error('[Audit]', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: 'An internal error occurred.', retryable: false });
  }
});

export default router;
