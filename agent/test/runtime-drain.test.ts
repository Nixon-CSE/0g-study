import { describe, it, expect } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntime } from '../src/runtime/agent.js';
import { MemoryStore } from '../src/memory/store.js';

const tmpDb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.tmp-drain.db');
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

describe('AgentRuntime.drain (graceful SIGTERM)', () => {
  it('waits for an in-flight turn, then refuses new ones', async () => {
    try { fs.unlinkSync(tmpDb); } catch {}
    const store = new MemoryStore(tmpDb, 8);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowModel = new MockLanguageModelV1({
      doGenerate: async () => {
        await gate;
        return { text: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1 }, rawCall: { rawPrompt: null, rawSettings: {} } };
      },
    });
    const rt = new AgentRuntime({
      loaded: { dir: '/tmp', config: cfg, soul: 's', agents: 'a', mcp: { servers: {} } },
      model: slowModel, embedModel: null, store, getSkills: () => [], getTools: () => ({}),
    });
    let first = '';
    const turn = rt.handle({ channel: 'test', chatId: 'c', userId: 'u', text: 'hi', reply: async (t: string) => { first = t; } } as any);
    await new Promise((r) => setTimeout(r, 20));
    const draining = rt.drain(5_000);
    setTimeout(release, 150);
    expect(await draining).toBe(0);
    await turn;
    expect(first).toBe('done');
    let second = '';
    await rt.handle({ channel: 'test', chatId: 'c', userId: 'u', text: 'again', reply: async (t: string) => { second = t; } } as any);
    expect(second).toContain('Restarting');
    store.close();
    try { fs.unlinkSync(tmpDb); } catch {}
  });
});
