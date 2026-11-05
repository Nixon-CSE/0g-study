import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

async function asAgent(app: Awaited<ReturnType<typeof makeApp>>, agentKey: string, path: string) {
  const res = await app.fetch(new Request(`http://test${path}`, {
    headers: { 'x-bonfire-agent-key': agentKey },
  }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe('internal routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  async function setup() {
    const alice = await registerAndLogin(app, { username: 'alice' }, tdb.db);
    const create = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'R', slug: 'researcher', baseUrl: 'http://x:7777',
      description: 'finds papers', tags: ['research'], visibility: 'public',
    }, alice.token);
    const agentKey = create.body.agentKey as string;
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`,
      { principalType: 'agent', principalId: create.body.agent.id }, alice.token);
    // Use the default 'general' channel auto-created with the server. No agent invocation needed.
    const channels = await jsonReq(app, 'GET', `/v1/servers/${server.body.server.id}/channels`, undefined, alice.token);
    const channel = channels.body.channels[0];
    return { alice, agent: create.body.agent, agentKey, server: server.body.server, channel };
  }

  it('GET /v1/internal/self returns the agent identity', async () => {
    const s = await setup();
    const r = await asAgent(app, s.agentKey, '/v1/internal/self');
    expect(r.status).toBe(200);
    expect(r.body.agent.slug).toBe('researcher');
    expect(r.body.agent.name).toBe('R');
  });

  it('GET /v1/internal/peers lists agents and users in this channel\'s server', async () => {
    const s = await setup();
    const r = await asAgent(app, s.agentKey, `/v1/internal/peers?channelId=${s.channel.id}`);
    expect(r.status).toBe(200);
    expect(r.body.agents.map((a: any) => a.slug)).toContain('researcher');
    expect(r.body.users.map((u: any) => u.username)).toContain('alice');
  });

  it('GET /v1/internal/channel-history returns recent messages', async () => {
    const s = await setup();
    // Insert a user message directly via DB to avoid invoking the (unreachable) agent.
    const { ObjectId } = await import('mongodb');
    const { collections } = await import('../src/db/types.js');
    await tdb.db.collection(collections.messages).insertOne({
      _id: new ObjectId(),
      channelId: new ObjectId(s.channel.id),
      serverId: new ObjectId(s.server.id),
      authorType: 'user',
      authorId: new ObjectId(s.alice.user.id),
      content: 'hello there',
      mentions: [],
      replyToId: null,
      createdAt: new Date(),
      editedAt: null,
    } as any);

    const r = await asAgent(app, s.agentKey, `/v1/internal/channel-history?channelId=${s.channel.id}&limit=10`);
    expect(r.status).toBe(200);
    expect(r.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(r.body.messages.some((m: any) => m.content === 'hello there')).toBe(true);
  });

  it('rejects bad agentKey with 401', async () => {
    const r = await asAgent(app, 'bka_garbage', '/v1/internal/self');
    expect(r.status).toBe(401);
  });

  it('rejects access to a channel where the agent is not a member', async () => {
    const s = await setup();
    const bob = await registerAndLogin(app, { username: 'bob' });
    const otherServer = await jsonReq(app, 'POST', '/v1/servers', { name: 'B', slug: 'b' }, bob.token);
    const otherCh = await jsonReq(app, 'GET', `/v1/servers/${otherServer.body.server.id}/channels`, undefined, bob.token);
    const otherChId = otherCh.body.channels[0].id;

    const r = await asAgent(app, s.agentKey, `/v1/internal/peers?channelId=${otherChId}`);
    expect(r.status).toBe(403);
  });
});
