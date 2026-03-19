/**
 * BUG: Rate limiter fails open when Redis is unavailable
 *
 * FOUND: src/server/middleware/rate-limit.ts lines 53-56
 *   .catch(() => {
 *     // If Redis is unavailable, fail open (don't block traffic)
 *     next();
 *   });
 *
 * If Redis crashes, ALL rate limiting is silently disabled, making the
 * endpoint vulnerable to unlimited requests / brute-force.
 *
 * FIX: Fail closed — return 503 when the rate-limit store is unavailable.
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';

// Build the middleware directly, injecting a controllable Redis pipeline
function makeRateLimitMiddleware(pipelineExecResult: Promise<any>) {
  // Inline a simplified version of the rate-limit logic to test the failure path
  return function rateLimitMcp(req: Request, res: Response, next: NextFunction): void {
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (!apiKey) { next(); return; }

    pipelineExecResult
      .then((results) => {
        if (!results) { next(); return; }
        const count = results[2][1] as number;
        if (count > 120) {
          res.status(429).json({ error_code: 'RATE_LIMITED', retryable: true });
          return;
        }
        next();
      })
      .catch((_err: Error) => {
        res.status(503).json({
          error_code: 'SERVICE_UNAVAILABLE',
          message: 'Rate limiting service temporarily unavailable. Please retry shortly.',
          retryable: true,
        });
      });
  };
}

describe('Rate limiter fail-closed behaviour', () => {
  it('returns 503 when Redis pipeline throws (fail-closed)', async () => {
    const failingPipeline = Promise.reject(new Error('Redis connection refused'));
    const middleware = makeRateLimitMiddleware(failingPipeline);

    const app = express();
    app.get('/test', middleware, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/test')
      .set('X-API-Key', 'any-key');

    expect(res.status).toBe(503);
    expect(res.body.error_code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.retryable).toBe(true);
  });

  it('passes the request through when Redis is healthy', async () => {
    // count = 1, well under limit of 120
    const okPipeline = Promise.resolve([null, null, [null, 1], null]);
    const middleware = makeRateLimitMiddleware(okPipeline);

    const app = express();
    app.get('/test', middleware, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/test')
      .set('X-API-Key', 'any-key');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 429 when limit is exceeded', async () => {
    // count = 200, over limit of 120
    const limitedPipeline = Promise.resolve([null, null, [null, 200], null]);
    const middleware = makeRateLimitMiddleware(limitedPipeline);

    const app = express();
    app.get('/test', middleware, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .get('/test')
      .set('X-API-Key', 'any-key');

    expect(res.status).toBe(429);
    expect(res.body.error_code).toBe('RATE_LIMITED');
  });

  it('the production source uses fail-closed (503) instead of fail-open (next())', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../../src/server/middleware/rate-limit.ts'),
      'utf8'
    );
    // After the fix, the catch block must NOT call next() — it must send 503
    const catchBlock = source.match(/\.catch\([\s\S]+?\}\s*\)\s*;/)?.[0] ?? '';
    expect(catchBlock).toMatch(/503/);
    expect(catchBlock).toMatch(/SERVICE_UNAVAILABLE/);
    // Must NOT contain a bare next() in the catch block
    expect(catchBlock).not.toMatch(/^\s*next\(\)\s*;?\s*$/m);
  });
});
