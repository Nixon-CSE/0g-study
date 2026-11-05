import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { collections } from '../src/db/types.js';

async function seedAgent(db: any, slug = 'researcher') {
  const doc = {
    _id: new ObjectId(),
    name: 'Researcher', slug, avatarUrl: null, description: 'x', bio: null,
    tags: [], baseUrl: 'http://agent.test:7777', visibility: 'public',
    createdBy: new ObjectId(), createdAt: new Date(), updatedAt: new Date(),
  };
  await db.collection(collections.agents).insertOne(doc);
  return doc;
}

describe('channel routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('owner creates a channel', async () => {
    const alice = await registerAndLogin(app);
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`,
      { name: 'announcements', topic: 'news' }, alice.token);
    expect(r.status).toBe(201);
    expect(r.body.channel.name).toBe('announcements');
    expect(r.body.channel.topic).toBe('news');
  });

  it('rejects defaultAgentId for an agent not in the server', async () => {
    const alice = await registerAndLogin(app);
    const agent = await seedAgent(tdb.db);
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`,
      { name: 'research', defaultAgentId: agent._id.toHexString() }, alice.token);
    expect(r.status).toBe(400);
  });

  it('accepts defaultAgentId for an invited agent', async () => {
    const alice = await registerAndLogin(app);
    const agent = await seedAgent(tdb.db);
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'agent', principalId: agent._id.toHexString() }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`,
      { name: 'research', defaultAgentId: agent._id.toHexString() }, alice.token);
    expect(r.status).toBe(201);
  });

  it('plain member cannot create channels', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: bob.user.id }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`,
      { name: 'x' }, bob.token);
    expect(r.status).toBe(403);
  });

  it('GET /v1/channels/:cid returns the channel for members', async () => {
    const alice = await registerAndLogin(app);
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const list = await jsonReq(app, 'GET', `/v1/servers/${s.body.server.id}/channels`, undefined, alice.token);
    const cid = list.body.channels[0].id;
    const r = await jsonReq(app, 'GET', `/v1/channels/${cid}`, undefined, alice.token);
    expect(r.status).toBe(200);
    expect(r.body.channel.name).toBe('general');
  });
});
