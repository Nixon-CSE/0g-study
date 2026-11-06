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
    expect(j.channels).toEqual({ web: true, telegram: false, telegramEnabled: false });
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

describe('/status channels.telegram is the live state (P3)', () => {
  const withTg = (enabled: boolean, running?: () => boolean) => statusRoutes({
    ...deps(),
    getConfig: () => ({ name: 'E', id: 'e', llm: { provider: 'zerog-router' }, channels: { web: { enabled: true }, telegram: { enabled } } }) as any,
    telegramRunning: running,
  });
  it('enabled in config but the bot is not connected (no token, bad token, crashed) → false', async () => {
    expect((await (await withTg(true, () => false).request('/status')).json()).channels).toEqual({ web: true, telegram: false, telegramEnabled: true });
    expect((await (await withTg(true).request('/status')).json()).channels.telegram).toBe(false);
  });
  it('connected → true', async () => {
    expect((await (await withTg(true, () => true).request('/status')).json()).channels.telegram).toBe(true);
  });
});

describe('TelegramAdapter.running', () => {
  it('is false when enabled without a token (start skips) and after stop', async () => {
    const { TelegramAdapter } = await import('../src/channels/telegram.js');
    delete process.env.TG_TEST_TOKEN_UNSET;
    const a = new TelegramAdapter({ channels: { telegram: { enabled: true, tokenEnv: 'TG_TEST_TOKEN_UNSET', dmPolicy: 'open', allowFrom: [], groups: {} } } } as any);
    await a.start(async () => {});
    expect(a.running).toBe(false);
    await a.stop();
    expect(a.running).toBe(false);
  });
});
