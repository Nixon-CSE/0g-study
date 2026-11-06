/**
 * P3: the agent profile shows Telegram "Active" only when it really is. GET /v1/agents/:aid/config
 * carries connections.telegram from the runtime's public /status, and never for a tenant persona.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

const state = { telegram: true, tenants: new Set<string>() };
function fakeRuntime() {
  const app = new Hono();
  app.get('/status', (c) => c.json({ ok: true, channels: { web: true, telegram: state.telegram, telegramEnabled: true } }));
  app.get('/config', (c) => c.json({ llm: { provider: 'zerog-router', model: 'deepseek-v4.1-flash' } }));
  app.get('/tenants/:slug', (c) => (state.tenants.has(c.req.param('slug'))
    ? c.json({ tenant: { slug: c.req.param('slug'), llm: { provider: 'zerog-router' } } })
    : c.json({ error: 'not_found' }, 404)));
  return app;
}

describe('GET /v1/agents/:aid/config → connections.telegram', () => {
  let tdb: TestDb;
  let server: ReturnType<typeof serve>;
  let base = '';
  beforeAll(async () => {
    tdb = await startTestDb();
    server = serve({ fetch: fakeRuntime().fetch, port: 0 });
    await new Promise((r) => setTimeout(r, 50));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(async () => { server.close(); await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); state.telegram = true; state.tenants.clear(); });

  async function agentAt(slug: string, baseUrl = base) {
    const app = await makeApp(tdb.db);
    const me = await registerAndLogin(app);
    await jsonReq(app, 'POST', '/v1/agents', { name: slug, slug, baseUrl, description: '.', tags: [], visibility: 'public' }, me.token);
    return async () => (await jsonReq(app, 'GET', `/v1/agents/${slug}/config`)).body;
  }

  it("true when the runtime's bot is connected and the agent is that runtime's own persona", async () => {
    const get = await agentAt('ember');
    expect((await get()).connections).toEqual({ telegram: true });
  });

  it('false for a tenant persona on a runtime whose bot is connected (the bot never reaches tenants)', async () => {
    state.tenants.add('study-tutor');
    const get = await agentAt('study-tutor');
    expect((await get()).connections).toEqual({ telegram: false });
  });

  it('false when Telegram is enabled but not connected', async () => {
    state.telegram = false;
    const get = await agentAt('ember');
    expect((await get()).connections).toEqual({ telegram: false });
  });

  it('false when the runtime is unreachable', async () => {
    const get = await agentAt('ghost', 'http://127.0.0.1:1');
    const body = await get();
    expect(body.connections).toEqual({ telegram: false });
    expect(body.model).toBeNull();
  });
});
