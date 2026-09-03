import type { Request, Response, NextFunction } from 'express';
import { getRedisConnection } from '../../queue/jobs';

// Sliding-window rate limiter using Redis sorted sets.
// Default: 120 requests / 60 seconds per API key.
const DEFAULT_WINDOW_SECS = 60;
const DEFAULT_MAX_REQUESTS = 120;

function getKey(apiKey: string): string {
  return `webbridge:rl:${apiKey}`;
}

export function rateLimitMcp(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    // No key = unauthenticated; let auth middleware handle rejection
    next();
    return;
  }

  const redis = getRedisConnection();
  const now = Date.now();
  const windowStart = now - DEFAULT_WINDOW_SECS * 1000;
  const key = getKey(apiKey);

  // Pipeline: remove old entries, add current, count, set expiry
  redis
    .pipeline()
    .zremrangebyscore(key, '-inf', windowStart)
    .zadd(key, now, `${now}-${Math.random()}`)
    .zcard(key)
    .expire(key, DEFAULT_WINDOW_SECS * 2)
    .exec()
    .then((results) => {
      if (!results) { next(); return; }
      const count = results[2][1] as number;

      res.setHeader('X-RateLimit-Limit', DEFAULT_MAX_REQUESTS);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, DEFAULT_MAX_REQUESTS - count));
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + DEFAULT_WINDOW_SECS * 1000) / 1000));

      if (count > DEFAULT_MAX_REQUESTS) {
        res.status(429).json({
          error_code: 'RATE_LIMITED',
          message: `Too many requests. Limit: ${DEFAULT_MAX_REQUESTS} per ${DEFAULT_WINDOW_SECS}s.`,
          retryable: true,
          retry_after: DEFAULT_WINDOW_SECS,
        });
        return;
      }
      next();
    })
    .catch((err: Error) => {
      // Fail closed — reject requests when the rate-limit store is unavailable.
      // Failing open would allow unlimited requests during Redis outages.
      console.error('[RateLimit] Redis error, failing closed:', err.message);
      res.status(503).json({
        error_code: 'SERVICE_UNAVAILABLE',
        message: 'Rate limiting service temporarily unavailable. Please retry shortly.',
        retryable: true,
      });
    });
}
