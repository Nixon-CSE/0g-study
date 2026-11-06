import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv, productionEnvProblems } from '../src/config/env.js';

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

describe('production boot checks', () => {
  const OK = {
    NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://x', PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 'b', CORS_ORIGINS: 'https://app.example',
    EMBER_AGENT_BASE_URL: 'http://agent.railway.internal:7777', AGENT_ADMIN_TOKEN: 't'.repeat(32),
  };
  it('passes when complete; development needs none of it', () => {
    expect(productionEnvProblems(OK)).toEqual([]);
    expect(productionEnvProblems({ NODE_ENV: 'development' })).toEqual([]);
  });
  it('fails fast without a real database', () => {
    expect(productionEnvProblems({ ...OK, MONGODB_URI: '' })).toEqual(['MONGODB_URI is required']);
    expect(productionEnvProblems({ ...OK, DEV_MEMORY_MONGO: 'true' })[0]).toMatch(/in-memory database/);
  });
  it('refuses mock storage and missing settings', () => {
    expect(productionEnvProblems({ ...OK, OG_STORAGE_MOCK: '1' })[0]).toMatch(/mock storage/);
    for (const k of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'CORS_ORIGINS', 'EMBER_AGENT_BASE_URL', 'AGENT_ADMIN_TOKEN']) {
      expect(productionEnvProblems({ ...OK, [k]: '' }).join(), k).toContain(k);
    }
  });
  it('loadEnv stops the boot', () => {
    const saved = { ...process.env };
    process.env = { NODE_ENV: 'production', MONGODB_DB: 'x', JWT_SECRET: 'a'.repeat(32) } as any;
    expect(() => loadEnv()).toThrow(/Refusing to start in production[\s\S]*MONGODB_URI/);
    process.env = saved;
  });
});

