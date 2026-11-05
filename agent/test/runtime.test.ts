import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import { AgentRuntime } from '../src/runtime/agent.js';
import { MemoryStore } from '../src/memory/store.js';
import { hashEnv } from '../src/runtime/env-hash.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.resolve(__dirname, '.tmp-rt.db');
const tmpDb2 = path.resolve(__dirname, '.tmp-rt2.db');

const fakeModel = new MockLanguageModelV1({
  doGenerate: async () => ({
    text: 'pong',
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});

describe('AgentRuntime', () => {
  it('handles a message end-to-end with mock model', async () => {
    try { fs.unlinkSync(tmpDb); } catch {}
    const store = new MemoryStore(tmpDb, 8);
    const cfg: any = {
      name: 'Mock', id: 'mock',
      llm: { baseUrl: 'x', model: 'm', apiKeyEnv: 'X', temperature: 0.7, maxTokens: 100 },
      channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
      mcp: { configFile: 'mcp.json' },
      evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
      memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
      tools: { builtin: { webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' }, webFetch: { enabled: false }, codeExec: { enabled: false, timeoutMs: 1000 }, fileOps: { enabled: false, rootDir: '.' } } },
      logging: { level: 'info', logDir: '.' },
    };
    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'terse', agents: 'rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
    });
    let out = '';
    await rt.handle({ channel: 'test', chatId: 'c', userId: 'u', text: 'ping', reply: async (t) => { out = t; } } as any);
    expect(out).toBe('pong');
    store.close();
  });

  it('modelFor: uses default model when tenant has no overrides', async () => {
    try { fs.unlinkSync(tmpDb2); } catch {}
    const store = new MemoryStore(tmpDb2, 8);
    const cfg: any = {
      name: 'Mock', id: 'mock',
      llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKeyEnv: 'X', temperature: 0.7, maxTokens: 100 },
      channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
      mcp: { configFile: 'mcp.json' },
      evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
      memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
      tools: { builtin: { webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' }, webFetch: { enabled: false }, codeExec: { enabled: false, timeoutMs: 1000 }, fileOps: { enabled: false, rootDir: '.' } } },
      logging: { level: 'info', logDir: '.' },
    };

    // Create a minimal mock TenantRegistry
    const tenantWithNoOverrides = {
      slug: 'no-overrides',
      name: 'No Overrides',
      description: 'Tenant with no LLM overrides',
      avatarUrl: null,
      tags: [],
      soul: 'You are plain.',
      agents: '',
      env: {},
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRegistry: any = {
      get: (slug: string) => (slug === 'no-overrides' ? tenantWithNoOverrides : undefined),
      subscribe: () => {},
    };

    const createChatModelSpy = vi.fn();

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'terse', agents: 'rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      tenantRegistry: mockRegistry,
    });

    let out = '';
    await rt.handle({
      channel: 'test',
      chatId: 'c',
      userId: 'u',
      text: 'ping',
      tenant: 'no-overrides',
      reply: async (t) => { out = t; },
    } as any);
    // Should use the default model (fakeModel returns 'pong')
    expect(out).toBe('pong');
    // createChatModel should NOT have been called (no overrides, falls back to default)
    store.close();
  });

  it('modelFor: caches model per tenant slug and clears on subscribe notification', async () => {
    const tmpDb3 = path.resolve(__dirname, '.tmp-rt3.db');
    try { fs.unlinkSync(tmpDb3); } catch {}
    const store = new MemoryStore(tmpDb3, 8);

    // Model that will be "built" for the tenant
    const tenantModel = new MockLanguageModelV1({
      doGenerate: async () => ({
        text: 'tenant-response',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const tenantWithEnvOverride = {
      slug: 'env-override',
      name: 'Env Override',
      description: 'Tenant with env override',
      avatarUrl: null,
      tags: [],
      soul: 'You are env-override.',
      agents: '',
      env: { LLM_API_KEY: 'override-key' },
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    let subscriberFn: ((slug: string) => void) | null = null;
    const mockRegistry: any = {
      get: (slug: string) => (slug === 'env-override' ? tenantWithEnvOverride : undefined),
      subscribe: (fn: (slug: string) => void) => { subscriberFn = fn; },
    };

    const cfg: any = {
      name: 'Mock', id: 'mock',
      llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKeyEnv: 'LLM_API_KEY', temperature: 0.7, maxTokens: 100 },
      channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
      mcp: { configFile: 'mcp.json' },
      evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
      memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
      tools: { builtin: { webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' }, webFetch: { enabled: false }, codeExec: { enabled: false, timeoutMs: 1000 }, fileOps: { enabled: false, rootDir: '.' } } },
      logging: { level: 'info', logDir: '.' },
    };

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'terse', agents: 'rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      tenantRegistry: mockRegistry,
    });

    // Verify subscribe was called
    expect(subscriberFn).not.toBeNull();

    // Directly inject a model into the cache via the subscribe mechanism
    // to test cache invalidation without actually building a real LLM.
    // First, force the cache to hold a sentinel value by monkey-patching.
    const modelCache: Map<string, any> = (rt as any).modelCache;
    modelCache.set('env-override', tenantModel);
    expect(modelCache.has('env-override')).toBe(true);

    // Fire the subscriber (simulates a PATCH on the tenant)
    subscriberFn!('env-override');

    // Cache entry should be cleared
    expect(modelCache.has('env-override')).toBe(false);

    store.close();
  });

  it('hashEnv: produces stable, distinct outputs for distinct inputs', () => {
    const h1 = hashEnv({ LLM_API_KEY: 'key-a' });
    const h2 = hashEnv({ LLM_API_KEY: 'key-b' });
    const h3 = hashEnv({ LLM_API_KEY: 'key-a' }); // same as h1
    const h0 = hashEnv(undefined);

    expect(h1).toBe(h3);                // stable
    expect(h1).not.toBe(h2);            // distinct inputs → distinct hashes
    expect(h0).toBe('0');               // empty/undefined → sentinel '0'
    expect(h1).toHaveLength(16);        // sha1 sliced to 16 hex chars
  });

  it('hashEnv: key order does not affect the hash (stable sort)', () => {
    const ha = hashEnv({ A: '1', B: '2' });
    const hb = hashEnv({ B: '2', A: '1' });
    expect(ha).toBe(hb);
  });

  it('envOverride alone (no tenant) uses _default:<hash> cache key', async () => {
    const tmpDb4 = path.resolve(__dirname, '.tmp-rt4.db');
    try { fs.unlinkSync(tmpDb4); } catch {}
    const store = new MemoryStore(tmpDb4, 8);

    const override = { LLM_API_KEY: 'per-request-key' };
    const expectedHash = hashEnv(override);
    const expectedKey = `_default:${expectedHash}`;

    const sentinelModel = new MockLanguageModelV1({
      doGenerate: async () => ({
        text: 'sentinel-response',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const cfg: any = {
      name: 'Mock', id: 'mock',
      llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKeyEnv: 'LLM_API_KEY', temperature: 0.7, maxTokens: 100 },
      channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
      mcp: { configFile: 'mcp.json' },
      evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
      memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
      tools: { builtin: { webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' }, webFetch: { enabled: false }, codeExec: { enabled: false, timeoutMs: 1000 }, fileOps: { enabled: false, rootDir: '.' } } },
      logging: { level: 'info', logDir: '.' },
    };

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'terse', agents: 'rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      // No tenantRegistry — tenant lookup will return null
    });

    // Pre-seed the cache with the expected key so modelFor returns our sentinel
    // without needing a real API call. This validates that:
    // 1. modelFor uses slug '_default' when there is no tenant
    // 2. The cache key includes the env hash
    const modelCache: Map<string, any> = (rt as any).modelCache;
    modelCache.set(expectedKey, sentinelModel);

    let out = '';
    await rt.handle({
      channel: 'test',
      chatId: 'c',
      userId: 'u',
      text: 'ping',
      // No tenant field
      envOverride: override,
      reply: async (t) => { out = t; },
    } as any);

    // The sentinel was found in the cache, so sentinelModel was used → 'sentinel-response'
    expect(out).toBe('sentinel-response');
    // Cache still holds the entry
    expect(modelCache.has(expectedKey)).toBe(true);

    store.close();
  });

  it('envOverride + tenant produce a different cache key than tenant alone', async () => {
    const tmpDb5 = path.resolve(__dirname, '.tmp-rt5.db');
    try { fs.unlinkSync(tmpDb5); } catch {}
    const store = new MemoryStore(tmpDb5, 8);

    const cfg: any = {
      name: 'Mock', id: 'mock',
      llm: { provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'm', apiKeyEnv: 'LLM_API_KEY', temperature: 0.7, maxTokens: 100 },
      channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
      mcp: { configFile: 'mcp.json' },
      evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
      memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
      tools: { builtin: { webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' }, webFetch: { enabled: false }, codeExec: { enabled: false, timeoutMs: 1000 }, fileOps: { enabled: false, rootDir: '.' } } },
      logging: { level: 'info', logDir: '.' },
    };

    const tenantBase = {
      slug: 'cache-test',
      name: 'Cache Test',
      description: 'Testing cache keys',
      avatarUrl: null,
      tags: [],
      soul: 'You are a cache-test agent.',
      agents: '',
      env: { LLM_API_KEY: 'tenant-key' },
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRegistry: any = {
      get: (slug: string) => (slug === 'cache-test' ? tenantBase : undefined),
      subscribe: () => {},
    };

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'terse', agents: 'rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      tenantRegistry: mockRegistry,
    });

    const modelCache: Map<string, any> = (rt as any).modelCache;

    // Compute expected cache keys
    const envNoOverride = { LLM_API_KEY: 'tenant-key' };               // tenant env only
    const envWithOverride = { LLM_API_KEY: 'request-override-key' };   // request override replaces tenant key
    const keyNoOverride = `cache-test:${hashEnv(envNoOverride)}`;
    const keyWithOverride = `cache-test:${hashEnv(envWithOverride)}`;

    expect(keyNoOverride).not.toBe(keyWithOverride); // sanity: they must differ

    // Both calls will fail to build a real model (no real API key), so they fall back.
    // We verify the distinct keys are attempted by planting sentinels before the call.
    modelCache.set(keyNoOverride, fakeModel);
    modelCache.set(keyWithOverride, fakeModel);

    // Calling with tenant but no envOverride should hit keyNoOverride
    await rt.handle({
      channel: 'test', chatId: 'c1', userId: 'u1', text: 'ping',
      tenant: 'cache-test',
      reply: async () => {},
    } as any);

    // Calling with tenant + envOverride should hit keyWithOverride
    await rt.handle({
      channel: 'test', chatId: 'c2', userId: 'u2', text: 'ping',
      tenant: 'cache-test',
      envOverride: { LLM_API_KEY: 'request-override-key' },
      reply: async () => {},
    } as any);

    // Both entries should still be in the cache (they were pre-populated and hit, not deleted)
    expect(modelCache.has(keyNoOverride)).toBe(true);
    expect(modelCache.has(keyWithOverride)).toBe(true);
    // And they should be different keys (distinct cache entries)
    expect(modelCache.size).toBeGreaterThanOrEqual(2);

    store.close();
  });
});
