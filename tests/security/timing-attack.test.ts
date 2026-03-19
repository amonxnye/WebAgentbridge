/**
 * BUG: Timing attack in API key comparison
 *
 * FOUND: src/server/middleware/auth.ts line 18
 *   if (!providedKey || providedKey !== masterKey)
 *
 * String !== comparison short-circuits on the first differing character,
 * leaking key length and prefix information via response-time side-channel.
 *
 * FIX: Use crypto.timingSafeEqual with fixed-length buffers.
 */

import { createServer } from 'http';
import express from 'express';
import request from 'supertest';

// Helpers to build a minimal app with the middleware under test
function buildApp(masterKey: string) {
  // We set env BEFORE importing so the module picks it up
  process.env.WEBBRIDGE_API_KEY = masterKey;
  jest.resetModules();
  const { requireApiKey } = require('../../src/server/middleware/auth');
  const app = express();
  app.get('/test', requireApiKey, (_req: any, res: any) => res.json({ ok: true }));
  return app;
}

describe('API key timing-safe comparison', () => {
  const MASTER = 'super-secret-api-key-1234567890ab';

  afterEach(() => {
    delete process.env.WEBBRIDGE_API_KEY;
    jest.resetModules();
  });

  it('rejects requests with a wrong key', async () => {
    const app = buildApp(MASTER);
    const res = await request(app)
      .get('/test')
      .set('X-API-Key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a key that is a prefix of the real key (timing attack vector)', async () => {
    const app = buildApp(MASTER);
    // A naive string comparison would accept this if it compared byte-by-byte
    // but the real guard here is correctness — the prefix must be rejected
    const res = await request(app)
      .get('/test')
      .set('X-API-Key', MASTER.slice(0, 5)); // partial key
    expect(res.status).toBe(401);
  });

  it('accepts requests with the correct key', async () => {
    const app = buildApp(MASTER);
    const res = await request(app)
      .get('/test')
      .set('X-API-Key', MASTER);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('uses crypto.timingSafeEqual (constant-time) in the implementation', () => {
    process.env.WEBBRIDGE_API_KEY = MASTER;
    jest.resetModules();
    const authSource = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/server/middleware/auth.ts'),
      'utf8'
    );
    // After the fix, the source must reference timingSafeEqual
    expect(authSource).toMatch(/timingSafeEqual/);
  });
});
