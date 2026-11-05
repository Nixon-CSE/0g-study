import { describe, it, expect } from 'vitest';
import { signToken, verifyToken } from '../src/auth/jwt.js';

const secret = 'x'.repeat(32);

describe('jwt', () => {
  it('signs and verifies a token', async () => {
    const token = await signToken({ sub: '507f1f77bcf86cd799439011', username: 'alice' }, secret, '1h');
    const claims = await verifyToken(token, secret);
    expect(claims.sub).toBe('507f1f77bcf86cd799439011');
    expect(claims.username).toBe('alice');
  });

  it('rejects a tampered token', async () => {
    const token = await signToken({ sub: 'u1', username: 'alice' }, secret, '1h');
    const bad = token.slice(0, -2) + 'aa';
    await expect(verifyToken(bad, secret)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signToken({ sub: 'u1', username: 'alice' }, secret, '1h');
    await expect(verifyToken(token, 'y'.repeat(32))).rejects.toThrow();
  });
});
