import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { collections } from '../src/db/types.js';

async function seedAgent(db: any, overrides: Partial<{ slug: string; name: string }> = {}) {
  const doc = {
    _id: new ObjectId(),
    name: overrides.name ?? 'Researcher',
    slug: overrides.slug ?? 'researcher',
    avatarUrl: null, description: 'finds papers', bio: null, tags: ['research'],
    baseUrl: 'http://agent.test:7777',
    visibility: 'public' as const,
    createdBy: new ObjectId(),
    createdAt: new Date(), updatedAt: new Date(),
  };
  await db.collection(collections.agents).insertOne(doc);
  return doc;
}

describe('member routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('owner can invite a user by id', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: bob.user.id }, alice.token);
    expect(r.status).toBe(201);
    const members = await jsonReq(app, 'GET', `/v1/servers/${s.body.server.id}/members`, undefined, alice.token);
    expect(members.body.members.length).toBe(2);
  });

  it('owner can invite an agent', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const agent = await seedAgent(tdb.db);
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'agent', principalId: agent._id.toHexString() }, alice.token);
    expect(r.status).toBe(201);
    const members = await jsonReq(app, 'GET', `/v1/servers/${s.body.server.id}/members?type=agent`, undefined, alice.token);
    expect(members.body.members.length).toBe(1);
    expect(members.body.members[0].principalType).toBe('agent');
  });

  it('plain member cannot invite anyone', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const carol = await registerAndLogin(app, { username: 'carol' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: bob.user.id }, alice.token);
    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: carol.user.id }, bob.token);
    expect(r.status).toBe(403);
  });

  it('a member can leave the server', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const invited = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: bob.user.id }, alice.token);
    const leave = await jsonReq(app, 'DELETE',
      `/v1/servers/${s.body.server.id}/members/${invited.body.member.id}`, undefined, bob.token);
    expect(leave.status).toBe(200);
  });
});
