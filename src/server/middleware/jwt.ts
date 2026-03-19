import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;          // user id
  email: string;
  name?: string;
  is_admin?: boolean;
  org_id?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      jwtUser?: JwtPayload;
    }
  }
}

/**
 * Optional JWT middleware — attaches decoded payload to req.jwtUser if a valid
 * Bearer token is present. Continues to next() regardless (auth enforcement is
 * handled downstream per route).
 */
export function attachJwt(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;
    req.jwtUser = payload;
  } catch {
    // Invalid / expired token — ignore, not required
  }

  next();
}

/**
 * Strict JWT guard — rejects requests without a valid token.
 */
export function requireJwt(req: Request, res: Response, next: NextFunction): void {
  if (!req.jwtUser) {
    res.status(401).json({
      error_code: 'UNAUTHORIZED',
      message: 'Valid Bearer token required.',
      retryable: false,
    });
    return;
  }
  next();
}

/**
 * Admin guard — requires JWT + is_admin = true.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.jwtUser || !req.jwtUser.is_admin) {
    res.status(403).json({
      error_code: 'FORBIDDEN',
      message: 'Admin access required.',
      retryable: false,
    });
    return;
  }
  next();
}

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable must be set before signing tokens');
  }
  return jwt.sign(payload, secret, { expiresIn: '24h' });
}
