import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

describe('agent price (PATCH priceOg)', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('owner can set priceOg via PATCH', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'PricedBot', slug: 'priced-bot', description: 'costs OG',
      baseUrl: 'http://ember:7777', tags: [],
    }, alice.token);
    expect(create.status).toBe(201);

    const patch = await jsonReq(app, 'PATCH', `/v1/agents/${create.body.agent.slug}`,
      { priceOg: '1.5' }, alice.token);
    expect(patch.status).toBe(200);
    expect(patch.body.agent.priceOg).toBe('1.5');
  });

  it('non-owner cannot PATCH priceOg (403)', async () => {
    const alice = await registerAndLogin(app, { username: 'alice2' });
    const bob = await registerAndLogin(app, { username: 'bob2' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'AliceBot', slug: 'alice-bot2', description: 'x',
      baseUrl: 'http://ember:7777', tags: [],
    }, alice.token);
    expect(create.status).toBe(201);

    const patch = await jsonReq(app, 'PATCH', `/v1/agents/${create.body.agent.slug}`,
      { priceOg: '99' }, bob.token);
    expect(patch.status).toBe(403);
  });

  it('publicAgent includes priceOg and ownerWallet fields', async () => {
    const alice = await registerAndLogin(app, { username: 'alice3' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'PubBot', slug: 'pub-bot', description: 'x',
      baseUrl: 'http://ember:7777', tags: [],
    }, alice.token);
    expect(create.status).toBe(201);

    // Default priceOg is '0', ownerWallet is null
    expect(create.body.agent.priceOg).toBe('0');
    expect(create.body.agent.ownerWallet).toBeNull();

    // After PATCH, the GET should reflect the new price
    await jsonReq(app, 'PATCH', `/v1/agents/${create.body.agent.slug}`,
      { priceOg: '2.0' }, alice.token);
    const get = await jsonReq(app, 'GET', `/v1/agents/${create.body.agent.slug}`);
    expect(get.body.agent.priceOg).toBe('2.0');
  });

  it('priceOg must match decimal regex — invalid value returns 400', async () => {
    const alice = await registerAndLogin(app, { username: 'alice4' });
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'ValidationBot', slug: 'val-bot', description: 'x',
      baseUrl: 'http://ember:7777', tags: [],
    }, alice.token);
    expect(create.status).toBe(201);

    const patch = await jsonReq(app, 'PATCH', `/v1/agents/${create.body.agent.slug}`,
      { priceOg: 'not-a-number' }, alice.token);
    expect(patch.status).toBe(400);
  });
});
