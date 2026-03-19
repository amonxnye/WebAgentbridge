import { Router } from 'express';
import bcrypt from 'bcrypt';
import { createUser, getUserByEmail, writeAuditLog } from '../../db/queries';
import { signToken } from '../middleware/jwt';

const router = Router();
const SALT_ROUNDS = 12;

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, password, name = '' } = req.body as {
    email?: string; password?: string; name?: string;
  };

  if (!email || !password) {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'email and password are required', retryable: false });
  }
  if (
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    return res.status(400).json({
      error_code: 'VALIDATION_ERROR',
      message: 'Password must be at least 12 characters and include uppercase, lowercase, digit, and special character',
      retryable: false,
    });
  }

  const existing = await getUserByEmail(email).catch(() => null);
  if (existing) {
    return res.status(409).json({ error_code: 'CONFLICT', message: 'Email already registered', retryable: false });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser({ email, name, passwordHash });

    const token = signToken({ sub: user.id, email: user.email, name: user.name });

    await writeAuditLog({
      action: 'USER_REGISTERED',
      resourceType: 'user',
      resourceId: user.id,
      userId: user.id,
      newValues: { email, name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    console.error('[Auth]', err);
    return res.status(500).json({ error_code: 'INTERNAL_ERROR', message: 'An internal error occurred.', retryable: false });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error_code: 'VALIDATION_ERROR', message: 'email and password are required', retryable: false });
  }

  const user = await getUserByEmail(email).catch(() => null);
  if (!user || !user.passwordHash) {
    // Constant-time rejection to prevent timing attacks
    await bcrypt.compare(password, '$2b$12$invalidhashpaddingtomatchtime');
    return res.status(401).json({ error_code: 'UNAUTHORIZED', message: 'Invalid credentials', retryable: false });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error_code: 'UNAUTHORIZED', message: 'Invalid credentials', retryable: false });
  }

  const token = signToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    is_admin: user.isAdmin,
  });

  await writeAuditLog({
    action: 'USER_LOGIN',
    resourceType: 'user',
    resourceId: user.id,
    userId: user.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  return res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
  });
});

// GET /auth/me
router.get('/me', async (req, res) => {
  if (!req.jwtUser) {
    return res.status(401).json({ error_code: 'UNAUTHORIZED', message: 'Not authenticated', retryable: false });
  }
  return res.json({
    id: req.jwtUser.sub,
    email: req.jwtUser.email,
    name: req.jwtUser.name,
    isAdmin: req.jwtUser.is_admin ?? false,
    orgId: req.jwtUser.org_id,
  });
});

export default router;
