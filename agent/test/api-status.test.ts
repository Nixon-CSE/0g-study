import { describe, it, expect } from 'vitest';
import { statusRoutes } from '../src/api/routes/status.js';

const deps = () => ({
  getConfig: () => ({
    name: 'Ember',
    id: 'ember',
    llm: { provider: 'openai-compatible', model: 'gpt-4o' },
    channels: { web: { enabled: true }, telegram: { enabled: false } },
  }) as any,
  listSkills: () => [{ name: 'learn' }, { name: 'foo' }] as any,
  evolutionMode: () => 'suggest' as const,
  memoryStats: () => ({ sessions: 2, messages: 5, vectors: 1 }),
});

describe('statusRoutes', () => {
  it('GET /status returns agent identity, config and live memory stats', async () => {
    const app = statusRoutes(deps());
    const res = await app.request('/status');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.name).toBe('Ember');
    expect(j.id).toBe('ember');
    expect(j.llm).toEqual({ provider: 'openai-compatible', model: 'gpt-4o' });
    expect(j.channels).toEqual({ web: true, telegram: false });
    expect(j.evolution).toBe('suggest');
    expect(j.skills).toEqual({ count: 2, names: ['learn', 'foo'] });
    expect(j.memory).toEqual({ sessions: 2, messages: 5, vectors: 1 });
    expect(typeof j.uptime).toBe('number');
  });

  it('reports model as null when the config pins no model', async () => {
    const d = deps();
    d.getConfig = () => ({
      name: 'Ember', id: 'ember',
      llm: { provider: 'zerog' },
      channels: { web: { enabled: true }, telegram: { enabled: false } },
    }) as any;
    const app = statusRoutes(d);
    const j = await (await app.request('/status')).json();
    expect(j.llm).toEqual({ provider: 'zerog', model: null });
  });
});
