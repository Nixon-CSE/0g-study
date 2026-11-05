import { describe, it, expect } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import { AgentRuntime } from '../src/runtime/agent.js';
import { MemoryStore } from '../src/memory/store.js';
import type { TenantPayload } from '../src/channels/base.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minimal AgentConfig for tests. */
function makeConfig(overrides: Record<string, unknown> = {}): any {
  return {
    name: 'TestAgent', id: 'test',
    llm: {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'default-model',
      apiKeyEnv: 'X',
      temperature: 0.7,
      maxTokens: 100,
    },
    channels: {
      telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} },
      web: { enabled: true, path: '/chat' },
    },
    mcp: { configFile: 'mcp.json' },
    evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
    memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' },
    tools: {
      builtin: {
        webSearch: { enabled: false, provider: 'tavily', apiKeyEnv: 'X' },
        webFetch: { enabled: false },
        codeExec: { enabled: false, timeoutMs: 1000 },
        fileOps: { enabled: false, rootDir: '.' },
      },
    },
    logging: { level: 'info', logDir: '.' },
    ...overrides,
  };
}

const fakeModel = new MockLanguageModelV1({
  doGenerate: async () => ({
    text: 'default-reply',
    finishReason: 'stop',
    usage: { promptTokens: 1, completionTokens: 1 },
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});

const inlineTenant: TenantPayload = {
  slug: 'my-inline-agent',
  name: 'Inline Agent',
  soul: 'You are the inline soul.',
  agents: 'Inline agent rules.',
  llm: {},
};

describe('AgentRuntime — inline tenant (tenantInline)', () => {

  it('uses soul and agents from tenantInline when no registry is present', async () => {
    const dbPath = path.resolve(__dirname, '.tmp-inline1.db');
    try { fs.unlinkSync(dbPath); } catch {}
    const store = new MemoryStore(dbPath, 8);

    let capturedSystem = '';
    const spyModel = new MockLanguageModelV1({
      doGenerate: async (opts: any) => {
        // Capture the system prompt so we can assert on soul/agents content.
        capturedSystem = opts.prompt
          .filter((m: any) => m.role === 'system')
          .map((m: any) => (Array.isArray(m.content) ? m.content.map((p: any) => p.text).join('') : m.content))
          .join('');
        return {
          text: 'inline-reply',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: makeConfig(), soul: 'default-soul', agents: 'default-rules', mcp: { servers: {} } },
      model: spyModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      // No tenantRegistry provided.
    });

    let out = '';
    await rt.handle({
      channel: 'web',
      chatId: 'c',
      userId: 'u',
      text: 'hello',
      tenantInline: inlineTenant,
      reply: async (t) => { out = t; },
    } as any);

    expect(out).toBe('inline-reply');
    // System prompt must contain inline soul and agents, not the defaults.
    expect(capturedSystem).toContain('You are the inline soul.');
    expect(capturedSystem).toContain('Inline agent rules.');
    expect(capturedSystem).not.toContain('default-soul');
    store.close();
  });

  it('inline tenant wins over slug when both are provided', async () => {
    const dbPath = path.resolve(__dirname, '.tmp-inline2.db');
    try { fs.unlinkSync(dbPath); } catch {}
    const store = new MemoryStore(dbPath, 8);

    const registryTenant = {
      slug: 'registry-agent',
      name: 'Registry Agent',
      description: 'From registry',
      avatarUrl: null,
      tags: [],
      soul: 'You are the REGISTRY soul.',
      agents: '',
      env: {},
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRegistry: any = {
      get: (slug: string) => (slug === 'registry-agent' ? registryTenant : undefined),
      subscribe: () => {},
    };

    let capturedSystem = '';
    const spyModel = new MockLanguageModelV1({
      doGenerate: async (opts: any) => {
        capturedSystem = opts.prompt
          .filter((m: any) => m.role === 'system')
          .map((m: any) => (Array.isArray(m.content) ? m.content.map((p: any) => p.text).join('') : m.content))
          .join('');
        return {
          text: 'inline-wins',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: makeConfig(), soul: 'default-soul', agents: 'default-rules', mcp: { servers: {} } },
      model: spyModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      tenantRegistry: mockRegistry,
    });

    let out = '';
    await rt.handle({
      channel: 'web',
      chatId: 'c',
      userId: 'u',
      text: 'hello',
      tenant: 'registry-agent',        // slug present too
      tenantInline: inlineTenant,       // inline takes priority
      reply: async (t) => { out = t; },
    } as any);

    expect(out).toBe('inline-wins');
    expect(capturedSystem).toContain('You are the inline soul.');
    expect(capturedSystem).not.toContain('You are the REGISTRY soul.');
    store.close();
  });

  it('falls back to registry when only slug is provided (regression)', async () => {
    const dbPath = path.resolve(__dirname, '.tmp-inline3.db');
    try { fs.unlinkSync(dbPath); } catch {}
    const store = new MemoryStore(dbPath, 8);

    const registryTenant = {
      slug: 'slug-only',
      name: 'Slug Only',
      description: 'Registry tenant',
      avatarUrl: null,
      tags: [],
      soul: 'You are the slug-only soul.',
      agents: '',
      env: {},
      llm: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockRegistry: any = {
      get: (slug: string) => (slug === 'slug-only' ? registryTenant : undefined),
      subscribe: () => {},
    };

    let capturedSystem = '';
    const spyModel = new MockLanguageModelV1({
      doGenerate: async (opts: any) => {
        capturedSystem = opts.prompt
          .filter((m: any) => m.role === 'system')
          .map((m: any) => (Array.isArray(m.content) ? m.content.map((p: any) => p.text).join('') : m.content))
          .join('');
        return {
          text: 'slug-reply',
          finishReason: 'stop',
          usage: { promptTokens: 1, completionTokens: 1 },
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: makeConfig(), soul: 'default-soul', agents: 'default-rules', mcp: { servers: {} } },
      model: spyModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
      tenantRegistry: mockRegistry,
    });

    let out = '';
    await rt.handle({
      channel: 'web',
      chatId: 'c',
      userId: 'u',
      text: 'hello',
      tenant: 'slug-only',      // slug only, no tenantInline
      reply: async (t) => { out = t; },
    } as any);

    expect(out).toBe('slug-reply');
    expect(capturedSystem).toContain('You are the slug-only soul.');
    store.close();
  });

  it('inline tenant with custom llm.model is visible via modelFor cache key', async () => {
    const dbPath = path.resolve(__dirname, '.tmp-inline4.db');
    try { fs.unlinkSync(dbPath); } catch {}
    const store = new MemoryStore(dbPath, 8);

    const customModelPayload: TenantPayload = {
      slug: 'custom-model-agent',
      name: 'Custom Model Agent',
      soul: 'Custom soul.',
      agents: '',
      llm: { model: 'gpt-4-custom', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' },
    };

    const sentinelModel = new MockLanguageModelV1({
      doGenerate: async () => ({
        text: 'sentinel-model-reply',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1 },
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

    const cfg = makeConfig({
      llm: {
        provider: 'openai-compatible',
        baseUrl: 'https://api.openai.com/v1',
        model: 'default-model',
        apiKeyEnv: 'OPENAI_API_KEY',
        temperature: 0.7,
        maxTokens: 100,
      },
    });

    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 'default-soul', agents: 'default-rules', mcp: { servers: {} } },
      model: fakeModel,
      embedModel: null,
      store,
      getSkills: () => [],
      getTools: () => ({}),
    });

    // The inline tenant has a custom llm.model, so modelFor will attempt to build a new model.
    // We pre-seed the cache with the expected key (slug:hash) so no real API call is made.
    // Cache key = slug:hashEnv({}) because tenantPayload has no `env` field → effectiveEnv = {}
    // ... but tenantLlm is non-empty, so hasOverrides = true and slug-based key is used.
    // Import hashEnv to compute the expected key.
    const { hashEnv } = await import('../src/runtime/env-hash.js');
    const expectedCacheKey = `custom-model-agent:${hashEnv({})}`;
    const modelCache: Map<string, any> = (rt as any).modelCache;
    modelCache.set(expectedCacheKey, sentinelModel);

    let out = '';
    await rt.handle({
      channel: 'web',
      chatId: 'c',
      userId: 'u',
      text: 'hello',
      tenantInline: customModelPayload,
      reply: async (t) => { out = t; },
    } as any);

    // Sentinel was found → sentinelModel was used
    expect(out).toBe('sentinel-model-reply');
    expect(modelCache.has(expectedCacheKey)).toBe(true);
    store.close();
  });
});
