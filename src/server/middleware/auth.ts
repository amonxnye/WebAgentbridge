import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Simple API key middleware.
 * Reads X-API-Key header and compares it using a constant-time operation to
 * prevent timing side-channel attacks.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const masterKey = process.env.WEBBRIDGE_API_KEY;

  // If no master key is configured, allow all requests (development mode)
  if (!masterKey) {
    next();
    return;
  }

  const providedKey = req.headers['x-api-key'];
  if (!providedKey || typeof providedKey !== 'string') {
    res.status(401).json({
      error_code: 'UNAUTHORIZED',
      message: 'Valid X-API-Key header required.',
      retryable: false,
    });
    return;
  }

  // Use constant-time comparison to prevent timing attacks
  const masterBuf   = Buffer.from(masterKey);
  const providedBuf = Buffer.alloc(masterBuf.length);
  providedBuf.write(providedKey);

  const valid = providedKey.length === masterKey.length &&
    timingSafeEqual(masterBuf, providedBuf);

  if (!valid) {
    res.status(401).json({
      error_code: 'UNAUTHORIZED',
      message: 'Valid X-API-Key header required.',
      retryable: false,
    });
    return;
  }

  next();
}
