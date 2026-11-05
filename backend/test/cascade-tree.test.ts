import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { collections } from '../src/db/types.js';

describe('cascade tree endpoint', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('returns all messages in the cascade tree rooted at :mid, sorted by createdAt ascending', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const channels = await jsonReq(app, 'GET', `/v1/servers/${server.body.server.id}/channels`, undefined, alice.token);
    const channelId = new ObjectId(channels.body.channels[0].id);
    const serverId = new ObjectId(server.body.server.id);

    // Seed three messages directly with cascade metadata.
    const rootId = new ObjectId();
    const childA = new ObjectId();
    const grandchild = new ObjectId();

    await tdb.db.collection(collections.messages).insertOne({
      _id: rootId, channelId, serverId,
      authorType: 'user', authorId: new ObjectId(alice.user.id),
      content: 'root', mentions: [], replyToId: null,
      parentMessageId: null, cascadeRootId: rootId, cascadeHop: 0,
      createdAt: new Date(Date.now() - 3000), editedAt: null,
    } as any);
    await tdb.db.collection(collections.messages).insertOne({
      _id: childA, channelId, serverId,
      authorType: 'agent', authorId: new ObjectId(),
      content: 'first reply', mentions: [], replyToId: null,
      parentMessageId: rootId, cascadeRootId: rootId, cascadeHop: 1,
      createdAt: new Date(Date.now() - 2000), editedAt: null,
    } as any);
    await tdb.db.collection(collections.messages).insertOne({
      _id: grandchild, channelId, serverId,
      authorType: 'agent', authorId: new ObjectId(),
      content: 'second reply', mentions: [], replyToId: null,
      parentMessageId: childA, cascadeRootId: rootId, cascadeHop: 2,
      createdAt: new Date(Date.now() - 1000), editedAt: null,
    } as any);

    const r = await jsonReq(app, 'GET', `/v1/messages/${rootId.toHexString()}/cascade`, undefined, alice.token);
    expect(r.status).toBe(200);
    expect(r.body.messages.length).toBe(3);
    expect(r.body.messages.map((m: any) => m.content)).toEqual(['root', 'first reply', 'second reply']);
  });

  it('PATCH /v1/channels/:cid cascadeEnabled:false persists and is reflected in GET', async () => {
    const alice = await registerAndLogin(app);
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const channels = await jsonReq(app, 'GET', `/v1/servers/${server.body.server.id}/channels`, undefined, alice.token);
    const cid = channels.body.channels[0].id;
    const before = await jsonReq(app, 'GET', `/v1/channels/${cid}`, undefined, alice.token);
    expect(before.body.channel.cascadeEnabled).toBe(true);

    const patched = await jsonReq(app, 'PATCH', `/v1/channels/${cid}`, { cascadeEnabled: false }, alice.token);
    expect(patched.status).toBe(200);
    expect(patched.body.channel.cascadeEnabled).toBe(false);

    const after = await jsonReq(app, 'GET', `/v1/channels/${cid}`, undefined, alice.token);
    expect(after.body.channel.cascadeEnabled).toBe(false);
  });

  it('non-member 403s on cascade tree GET', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const channels = await jsonReq(app, 'GET', `/v1/servers/${server.body.server.id}/channels`, undefined, alice.token);
    const channelId = new ObjectId(channels.body.channels[0].id);
    const serverId = new ObjectId(server.body.server.id);

    const rootId = new ObjectId();
    await tdb.db.collection(collections.messages).insertOne({
      _id: rootId, channelId, serverId,
      authorType: 'user', authorId: new ObjectId(alice.user.id),
      content: 'private', mentions: [], replyToId: null,
      parentMessageId: null, cascadeRootId: rootId, cascadeHop: 0,
      createdAt: new Date(), editedAt: null,
    } as any);

    const r = await jsonReq(app, 'GET', `/v1/messages/${rootId.toHexString()}/cascade`, undefined, bob.token);
    expect(r.status).toBe(403);
  });
});
