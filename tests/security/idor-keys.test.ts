/**
 * BUG: IDOR — consumer key deletion has no ownership check
 *
 * FOUND: src/server/routes/keys.ts line 68
 *   await revokeConsumerKey(keyId);  // <— no check that keyId belongs to site
 *
 * An attacker authenticated to site-A can delete consumer keys belonging to
 * site-B by supplying a valid keyId from another site in the URL.
 *
 * FIX: Fetch the consumer key record first and verify its site_id matches
 *      the site resolved from the :slug URL parameter.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../../src/db/queries', () => ({
  getSiteBySlug: jest.fn(),
  createConsumerKey: jest.fn(),
  getConsumerKeysBySite: jest.fn(),
  getConsumerKeyById: jest.fn(),
  revokeConsumerKey: jest.fn().mockResolvedValue(undefined),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/server/middleware/auth', () => ({
  requireApiKey: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/server/middleware/jwt', () => ({
  attachJwt: (_req: any, _res: any, next: any) => {
    _req.jwtUser = { sub: 'user-1', email: 'a@b.com' };
    next();
  },
}));

import {
  getSiteBySlug,
  getConsumerKeyById,
  revokeConsumerKey,
} from '../../src/db/queries';

import keysRouter from '../../src/server/routes/keys';
const app = express();
app.use(express.json());
app.use('/api/sites/:slug/keys', keysRouter);

describe('IDOR: consumer key deletion ownership check', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 when the keyId belongs to a different site', async () => {
    (getSiteBySlug as jest.Mock).mockResolvedValue({ id: 'site-A', slug: 'site-a' });
    // Key belongs to a different site
    (getConsumerKeyById as jest.Mock).mockResolvedValue({ id: 'key-xyz', siteId: 'site-B' });

    const res = await request(app)
      .delete('/api/sites/site-a/keys/key-xyz');

    expect(res.status).toBe(403);
    expect(res.body.error_code).toBe('FORBIDDEN');
    // revokeConsumerKey must NOT be called
    expect(revokeConsumerKey).not.toHaveBeenCalled();
  });

  it('returns 403 when the key does not exist', async () => {
    (getSiteBySlug as jest.Mock).mockResolvedValue({ id: 'site-A', slug: 'site-a' });
    (getConsumerKeyById as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .delete('/api/sites/site-a/keys/nonexistent-key');

    expect(res.status).toBe(403);
    expect(revokeConsumerKey).not.toHaveBeenCalled();
  });

  it('revokes the key when it belongs to the correct site', async () => {
    (getSiteBySlug as jest.Mock).mockResolvedValue({ id: 'site-A', slug: 'site-a' });
    (getConsumerKeyById as jest.Mock).mockResolvedValue({ id: 'key-xyz', siteId: 'site-A' });

    const res = await request(app)
      .delete('/api/sites/site-a/keys/key-xyz');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(revokeConsumerKey).toHaveBeenCalledWith('key-xyz');
  });
});
