/**
 * BUGS: Missing input validation
 *
 * 1. crawlDepth not validated (sites.ts lines 36-43)
 *    - Accepts negative numbers, non-integers, or strings like "abc"
 *    - A string crawlDepth breaks depth comparison in crawler
 *
 * 2. Password strength too weak (auth.ts line 18)
 *    - Only checked length >= 8
 *    - Accepted "12345678" or "aaaaaaaa"
 *
 * FIX: Validate crawlDepth is a non-negative integer; require mixed-character passwords.
 */

import express from 'express';
import request from 'supertest';

// ── mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../../src/db/queries', () => ({
  getSiteBySlug: jest.fn().mockResolvedValue(null),
  createSite: jest.fn().mockResolvedValue({
    id: 's1', slug: 'example-com', url: 'https://example.com',
    name: 'example.com', description: '', crawlDepth: 3,
  }),
  updateSiteRecrawl: jest.fn().mockResolvedValue(undefined),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  createUser: jest.fn(),
  getUserByEmail: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/queue/jobs', () => ({
  enqueueCrawl: jest.fn().mockResolvedValue('job-1'),
}));
jest.mock('../../src/server/middleware/auth', () => ({
  requireApiKey: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../src/server/middleware/jwt', () => ({
  attachJwt: (_req: any, _res: any, next: any) => next(),
  signToken: jest.fn().mockReturnValue('fake.jwt.token'),
}));

import { createUser } from '../../src/db/queries';
import { signToken } from '../../src/server/middleware/jwt';

import sitesRouter from '../../src/server/routes/sites';
import authRouter from '../../src/server/routes/auth';

const sitesApp = express();
sitesApp.use(express.json());
sitesApp.use('/api/sites', sitesRouter);

const authApp = express();
authApp.use(express.json());
authApp.use('/auth', authRouter);

// ── crawlDepth validation ─────────────────────────────────────────────────────
describe('crawlDepth input validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects negative crawlDepth', async () => {
    const res = await request(sitesApp)
      .post('/api/sites')
      .send({ url: 'https://example.com', crawlDepth: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-integer crawlDepth (float)', async () => {
    const res = await request(sitesApp)
      .post('/api/sites')
      .send({ url: 'https://example.com', crawlDepth: 2.7 });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('rejects string crawlDepth', async () => {
    const res = await request(sitesApp)
      .post('/api/sites')
      .send({ url: 'https://example.com', crawlDepth: 'deep' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid crawlDepth of 0', async () => {
    const res = await request(sitesApp)
      .post('/api/sites')
      .send({ url: 'https://example.com', crawlDepth: 0 });
    expect(res.status).toBe(201);
  });

  it('accepts valid crawlDepth of 5', async () => {
    const res = await request(sitesApp)
      .post('/api/sites')
      .send({ url: 'https://example.com', crawlDepth: 5 });
    expect(res.status).toBe(201);
  });
});

// ── password strength validation ──────────────────────────────────────────────
describe('Password strength validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects all-numeric passwords like "12345678"', async () => {
    const res = await request(authApp)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: '12345678' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('rejects all-lowercase passwords like "aaaaaaaa"', async () => {
    const res = await request(authApp)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'aaaaaaaa' });
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('rejects passwords shorter than 12 characters', async () => {
    const res = await request(authApp)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'Abc123!!' }); // 8 chars, but now min is 12
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe('VALIDATION_ERROR');
  });

  it('accepts a strong password with mixed characters', async () => {
    (createUser as jest.Mock).mockResolvedValue({
      id: 'u1', email: 'user@example.com', name: '',
    });
    (signToken as jest.Mock).mockReturnValue('tok');

    const res = await request(authApp)
      .post('/auth/register')
      .send({ email: 'user@example.com', password: 'MyStr0ng!Pass#2024' });
    expect(res.status).toBe(201);
  });
});
