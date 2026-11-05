import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

describe('agent routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('registers an agent and lists it', async () => {
    const me = await registerAndLogin(app);
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Researcher', slug: 'researcher', description: 'finds papers',
      baseUrl: 'http://ember:7777', tags: ['research'],
    }, me.token);
    expect(create.status).toBe(201);
    const list = await jsonReq(app, 'GET', '/v1/agents');
    expect(list.body.agents.length).toBe(1);
    expect(list.body.agents[0].slug).toBe('researcher');
  });

  it('lists all agents on GET /v1/agents', async () => {
    const me = await registerAndLogin(app);
    await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Alpha', slug: 'alpha', description: 'x',
      baseUrl: 'http://x:7777', tags: [],
    }, me.token);
    await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Beta', slug: 'beta', description: 'x',
      baseUrl: 'http://x:7777', tags: [],
    }, me.token);
    const list = await jsonReq(app, 'GET', '/v1/agents');
    expect(list.body.agents.length).toBe(2);
    const slugs = list.body.agents.map((a: { slug: string }) => a.slug).sort();
    expect(slugs).toEqual(['alpha', 'beta']);
  });

  it('non-owner cannot delete', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const c = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'A', slug: 'a', description: 'x', baseUrl: 'http://x:7777', tags: [],
    }, alice.token);
    const r = await jsonReq(app, 'DELETE', `/v1/agents/${c.body.agent.id}`, undefined, bob.token);
    expect(r.status).toBe(403);
  });

  it('filters by tag', async () => {
    const me = await registerAndLogin(app);
    await jsonReq(app, 'POST', '/v1/agents', {
      name: 'R', slug: 'r', description: 'x', baseUrl: 'http://x:7777', tags: ['research'],
    }, me.token);
    await jsonReq(app, 'POST', '/v1/agents', {
      name: 'C', slug: 'c', description: 'x', baseUrl: 'http://x:7777', tags: ['code'],
    }, me.token);
    const r = await jsonReq(app, 'GET', '/v1/agents?tag=research');
    expect(r.body.agents.map((a: any) => a.slug)).toEqual(['r']);
  });

  it('returns agentKey once on creation; never on subsequent reads', async () => {
    const me = await registerAndLogin(app);
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'A', slug: 'a', description: 'x', baseUrl: 'http://x:7777', tags: [],
    }, me.token);
    expect(create.body.agentKey).toMatch(/^bka_[a-f0-9]{32,}$/);

    const read = await jsonReq(app, 'GET', '/v1/agents/a');
    expect(read.body.agent).not.toHaveProperty('agentKey');
    expect(read.body.agent).not.toHaveProperty('agentKeyHash');
  });

  it('owner can rotate agentKey', async () => {
    const me = await registerAndLogin(app);
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'A', slug: 'a-rot', description: 'x', baseUrl: 'http://x:7777', tags: [],
    }, me.token);
    const firstKey = create.body.agentKey;

    const rot = await jsonReq(app, 'POST', `/v1/agents/${create.body.agent.id}/rotate-key`, {}, me.token);
    expect(rot.status).toBe(200);
    expect(rot.body.agentKey).toMatch(/^bka_[a-f0-9]{32,}$/);
    expect(rot.body.agentKey).not.toBe(firstKey);
  });

  it('non-owner cannot rotate key', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-rk' });
    const bob = await registerAndLogin(app, { username: 'bob-rk' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'A', slug: 'a-foreign', description: 'x', baseUrl: 'http://x:7777', tags: [],
    }, alice.token);
    const rot = await jsonReq(app, 'POST', `/v1/agents/${create.body.agent.id}/rotate-key`, {}, bob.token);
    expect(rot.status).toBe(403);
  });

  it('POST /v1/agents accepts llm.provider "zerog-router" (0G Private Computer)', async () => {
    const me = await registerAndLogin(app);
    const res = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Tutor', slug: 'study-tutor-x', description: 'explains notes',
      // Unreachable on purpose: the body must pass validation (not 400) before the tenant call fails.
      baseUrl: 'http://127.0.0.1:1', tags: [], soul: 's', agents: 'a',
      llm: { provider: 'zerog-router' },
    }, me.token);
    expect(res.status).not.toBe(400);
    expect(res.body.error).not.toBe('invalid_body');
  });

  it('POST /v1/agents without soul/agents still creates the marketplace record normally', async () => {
    const me = await registerAndLogin(app);
    const res = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Basic', slug: 'basic-no-soul', description: 'no soul provided',
      baseUrl: 'http://x:7777', tags: [],
    }, me.token);
    expect(res.status).toBe(201);
    expect(res.body.agent.slug).toBe('basic-no-soul');
    expect(res.body.agentKey).toMatch(/^bka_/);
  });

  it('PATCH /v1/agents/:aid forbidden for non-owner regardless of body', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-p' });
    const bob = await registerAndLogin(app, { username: 'bob-p' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Alice Bot', slug: 'alice-bot', description: 'x',
      baseUrl: 'http://x:7777', tags: [],
    }, alice.token);
    expect(create.status).toBe(201);
    const patch = await jsonReq(app, 'PATCH', `/v1/agents/${create.body.agent.id}`,
      { description: 'hijack' }, bob.token);
    expect(patch.status).toBe(403);
  });
});
