import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TenantRegistry } from '../src/tenants/registry.js';
import { TenantSchema } from '../src/tenants/types.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

let tmpDir: string;
let filePath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenants-test-'));
  filePath = path.join(tmpDir, 'tenants.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('TenantSchema', () => {
  it('parses a tenant with env and llm fields', () => {
    const parsed = TenantSchema.parse({
      slug: 'test',
      name: 'Test',
      description: 'A test tenant',
      env: { MY_API_KEY: 'secret' },
      llm: { temperature: 0.9, model: 'gpt-4o' },
    });
    expect(parsed.env).toEqual({ MY_API_KEY: 'secret' });
    expect(parsed.llm.temperature).toBe(0.9);
    expect(parsed.llm.model).toBe('gpt-4o');
  });

  it('defaults env to {} and llm to {} when omitted', () => {
    const parsed = TenantSchema.parse({
      slug: 'minimal',
      name: 'Minimal',
      description: 'Minimal tenant',
    });
    expect(parsed.env).toEqual({});
    expect(parsed.llm).toEqual({});
  });

  it('validates env must be Record<string, string>', () => {
    expect(() => TenantSchema.parse({
      slug: 'bad',
      name: 'Bad',
      description: 'Bad env',
      env: { key: 123 },
    })).toThrow();
  });

  it('validates llm.provider must be a valid enum when provided', () => {
    expect(() => TenantSchema.parse({
      slug: 'bad',
      name: 'Bad',
      description: 'Bad llm',
      llm: { provider: 'invalid-provider' },
    })).toThrow();
  });
});

describe('TenantRegistry', () => {
  it('seeds defaults when file does not exist', async () => {
    const reg = new TenantRegistry(filePath);
    await reg.load();
    const tenants = reg.all();
    expect(tenants.length).toBeGreaterThan(0);
    // All seeded tenants should have env and llm fields
    for (const t of tenants) {
      expect(t.env).toBeDefined();
      expect(t.llm).toBeDefined();
    }
  });

  it('round-trips env and llm fields through create/get', async () => {
    const reg = new TenantRegistry(filePath);
    await reg.load();

    const result = await reg.create({
      slug: 'with-env',
      name: 'With Env',
      description: 'Tenant with env overrides',
      avatarUrl: null,
      tags: [],
      soul: 'You are test.',
      agents: '',
      env: { LLM_API_KEY: 'override-key' },
      llm: { temperature: 0.3, model: 'gpt-4o-mini' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.tenant.env).toEqual({ LLM_API_KEY: 'override-key' });
    expect(result.tenant.llm.temperature).toBe(0.3);
    expect(result.tenant.llm.model).toBe('gpt-4o-mini');

    // Verify persistence: reload from disk
    const reg2 = new TenantRegistry(filePath);
    await reg2.load();
    const loaded = reg2.get('with-env');
    expect(loaded).toBeDefined();
    expect(loaded?.env).toEqual({ LLM_API_KEY: 'override-key' });
    expect(loaded?.llm.temperature).toBe(0.3);
  });

  it('patch updates env and llm fields', async () => {
    const reg = new TenantRegistry(filePath);
    await reg.load();

    await reg.create({
      slug: 'patchable',
      name: 'Patchable',
      description: 'Can be patched',
      avatarUrl: null,
      tags: [],
      soul: '',
      agents: '',
      env: {},
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = await reg.update('patchable', {
      env: { CUSTOM_KEY: 'value1' },
      llm: { temperature: 0.5 },
    });

    expect(updated).not.toBeNull();
    expect(updated?.env).toEqual({ CUSTOM_KEY: 'value1' });
    expect(updated?.llm.temperature).toBe(0.5);
  });

  it('subscribe fires on create, update, and delete', async () => {
    const reg = new TenantRegistry(filePath);
    await reg.load();

    const events: string[] = [];
    reg.subscribe((slug) => events.push(slug));

    await reg.create({
      slug: 'evt-test',
      name: 'Evt Test',
      description: 'For event testing',
      avatarUrl: null,
      tags: [],
      soul: '',
      agents: '',
      env: {},
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(events).toContain('evt-test');

    await reg.update('evt-test', { name: 'Updated' });
    expect(events.filter(s => s === 'evt-test').length).toBe(2);

    await reg.remove('evt-test');
    expect(events.filter(s => s === 'evt-test').length).toBe(3);
  });

  it('keeps previous state when loaded JSON is malformed', async () => {
    const reg = new TenantRegistry(filePath);
    await reg.load(); // seeds
    const seedCount = reg.all().length;

    // Corrupt the file
    await fs.writeFile(filePath, '{ invalid json !!!', 'utf8');

    // Re-load should not crash and should keep previous state
    await reg.load();
    expect(reg.all().length).toBe(seedCount);
  });
});
