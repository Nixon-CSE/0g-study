import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('parses a valid env', () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    process.env.MONGODB_DB = 'bonfire-test';
    process.env.JWT_SECRET = 'a'.repeat(32);
    const env = loadEnv();
    expect(env.MONGODB_DB).toBe('bonfire-test');
    expect(env.PORT).toBe(8080);
    expect(env.JWT_EXPIRES_IN).toBe('7d');
  });

  it('rejects a short JWT_SECRET', () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    process.env.MONGODB_DB = 'bonfire-test';
    process.env.JWT_SECRET = 'too-short';
    expect(() => loadEnv()).toThrow();
  });

  it('requires MONGODB_URI', () => {
    delete process.env.MONGODB_URI;
    process.env.MONGODB_DB = 'bonfire-test';
    process.env.JWT_SECRET = 'a'.repeat(32);
    expect(() => loadEnv()).toThrow();
  });
});
