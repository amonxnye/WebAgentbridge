/**
 * BUG: Internal error messages leaked to API clients
 *
 * FOUND: src/server/routes/sites.ts line 30, 87
 *         src/server/routes/auth.ts line 48
 *         src/server/routes/marketplace.ts line 90
 *         src/server/routes/audit.ts line 38
 *
 * Raw database error messages are returned directly to clients,
 * leaking schema, table, and constraint information.
 *
 * FIX: Log full error server-side; return only a generic message.
 */

import express from 'express';
import request from 'supertest';

jest.mock('../../src/db/queries', () => ({
  getSitesSummary: jest.fn(),
  getSiteBySlug: jest.fn().mockResolvedValue(null),
  createSite: jest.fn(),
  updateSiteRecrawl: jest.fn(),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/queue/jobs', () => ({ enqueueCrawl: jest.fn() }));
jest.mock('../../src/server/middleware/auth', () => ({
  requireApiKey: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/server/middleware/jwt', () => ({
  attachJwt: (_req: any, _res: any, next: any) => next(),
}));

import { getSitesSummary, createSite } from '../../src/db/queries';
import sitesRouter from '../../src/server/routes/sites';

const app = express();
app.use(express.json());
app.use('/api/sites', sitesRouter);

// suppress expected error logs in test output
const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

describe('Error message sanitization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not leak database error details in GET /api/sites', async () => {
    const sensitiveError = new Error(
      'relation "sites" does not exist — schema: public, table: sites'
    );
    (getSitesSummary as jest.Mock).mockRejectedValue(sensitiveError);

    const res = await request(app).get('/api/sites');

    expect(res.status).toBe(500);
    // The internal error details must NOT be in the response body
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/relation/i);
    expect(body).not.toMatch(/schema.*public/i);
    expect(res.body.error_code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('An internal error occurred.');
  });

  it('does not leak database constraint names in POST /api/sites', async () => {
    const sensitiveError = new Error(
      'duplicate key value violates unique constraint "sites_slug_key"'
    );
    (createSite as jest.Mock).mockRejectedValue(sensitiveError);

    const res = await request(app)
      .post('/api/sites')
      .send({ url: 'https://example.com' });

    expect(res.status).toBe(500);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/constraint/i);
    expect(body).not.toMatch(/sites_slug_key/i);
    expect(res.body.message).toBe('An internal error occurred.');
  });
});
