import type { Request, Response, NextFunction } from 'express';

/**
 * Simple API key middleware.
 * Reads X-API-Key header. In Phase 1 this validates against a single server-side
 * key from WEBBRIDGE_API_KEY env var. Phase 2 will wire this to the consumer_keys table.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const masterKey = process.env.WEBBRIDGE_API_KEY;

  // If no master key is configured, allow all requests (development mode)
  if (!masterKey) {
    next();
    return;
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== masterKey) {
    res.status(401).json({
      error_code: 'UNAUTHORIZED',
      message: 'Valid X-API-Key header required.',
      retryable: false,
    });
    return;
  }

  next();
}
