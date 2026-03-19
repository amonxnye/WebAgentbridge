/**
 * BUG: Hard-coded JWT fallback secret
 *
 * FOUND: src/server/middleware/jwt.ts line 83
 *   const secret = process.env.JWT_SECRET ?? 'insecure-dev-secret';
 *
 * If JWT_SECRET is not set in production, tokens are signed with a well-known
 * string that any attacker can use to forge admin tokens.
 *
 * FIX: Throw a startup error when JWT_SECRET is absent.
 */

describe('JWT secret configuration', () => {
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    // restore env after each test
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
    jest.resetModules();
  });

  it('should throw when JWT_SECRET is not set and signToken is called', () => {
    delete process.env.JWT_SECRET;
    // Re-import after clearing env so module picks up the missing var
    const { signToken } = require('../../src/server/middleware/jwt');
    expect(() => signToken({ sub: 'u1', email: 'a@b.com' })).toThrow(
      /JWT_SECRET/i
    );
  });

  it('should sign a token when JWT_SECRET is set', () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long!!';
    const { signToken } = require('../../src/server/middleware/jwt');
    const token = signToken({ sub: 'u1', email: 'a@b.com' });
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3); // valid JWT structure
  });
});
