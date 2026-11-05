import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

/** Fake agent whose replies are scripted. */
function makeScriptedAgent(script: (incoming: string) => string) {
  const app = new Hono();
  const pending = new Map<string, string>();
  app.post('/chat/message', async (c) => {
    const body = await c.req.json();
    const text = body.text ?? '';
    const out = script(text);
    const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(streamId, out);
    return c.json({ streamId });
  });
  app.get('/chat/stream/:id', (c) => {
    const id = c.req.param('id');
    const out = pending.get(id) ?? '';
    pending.delete(id);
    return stream(c, async (s) => {
      s.write(`data: ${JSON.stringify({ chunk: out })}\n\n`);
      s.write(`event: done\ndata: {}\n\n`);
    });
  });
  return app;
}

describe('cascade', () => {
  let tdb: TestDb;
  const servers: ReturnType<typeof serve>[] = [];
  const ports: Record<string, number> = {};

  beforeAll(async () => {
    tdb = await startTestDb();
    const r = serve({ fetch: makeScriptedAgent(() => 'found papers. @critic please review').fetch, port: 0 });
    const c = serve({ fetch: makeScriptedAgent(() => 'I disagree.').fetch, port: 0 });
    servers.push(r, c);
    await new Promise((res) => setTimeout(res, 50));
    ports.researcher = (r.address() as any).port;
    ports.critic = (c.address() as any).port;
  });
  afterAll(async () => { servers.forEach(s => s.close()); await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); });

  async function setup(app: Awaited<ReturnType<typeof makeApp>>) {
    const me = await registerAndLogin(app, { username: 'alice' });
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'X', slug: 'x' }, me.token);
    const researcher = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Researcher', slug: 'researcher', baseUrl: `http://127.0.0.1:${ports.researcher}`,
      description: '.', tags: [], visibility: 'public',
    }, me.token);
    const critic = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Critic', slug: 'critic', baseUrl: `http://127.0.0.1:${ports.critic}`,
      description: '.', tags: [], visibility: 'public',
    }, me.token);
    await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`,
      { principalType: 'agent', principalId: researcher.body.agent.id }, me.token);
    await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`,
      { principalType: 'agent', principalId: critic.body.agent.id }, me.token);
    const ch = await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/channels`,
      { name: 'research', defaultAgentId: researcher.body.agent.id }, me.token);
    return { me, channel: ch.body.channel };
  }

  it('cascades: user -> researcher -> critic, all messages in transcript', async () => {
    const app = await makeApp(tdb.db);
    const { me, channel } = await setup(app);
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'find me AI papers' }, me.token);
    expect(post.status).toBe(201);
    expect(post.body.replies.length).toBe(2);
    expect(post.body.replies[0].content).toContain('@critic');
    expect(post.body.replies[1].content).toBe('I disagree.');

    const list = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages?limit=10`, undefined, me.token);
    const all = list.body.messages;
    const root = all.find((m: any) => m.content === 'find me AI papers');
    const researcherReply = all.find((m: any) => m.content.includes('@critic'));
    const criticReply = all.find((m: any) => m.content === 'I disagree.');
    expect(root).toBeTruthy();
    expect(researcherReply).toBeTruthy();
    expect(criticReply).toBeTruthy();
    expect(researcherReply.parentMessageId).toBe(root.id);
    expect(criticReply.parentMessageId).toBe(researcherReply.id);
    expect(researcherReply.cascadeRootId).toBe(root.id);
    expect(criticReply.cascadeRootId).toBe(root.id);
    expect(root.cascadeHop).toBe(0);
    expect(researcherReply.cascadeHop).toBe(1);
    expect(criticReply.cascadeHop).toBe(2);
  });

  it('hop limit stops the chain', async () => {
    const app = await makeApp(tdb.db, { cascadeConfig: { maxHops: 1 } });
    const { me, channel } = await setup(app);
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'find me AI papers' }, me.token);
    expect(post.body.replies.length).toBe(1);
    expect(post.body.replies[0].content).toContain('@critic');
  });

  it('cascadeEnabled=false on channel blocks the chain', async () => {
    const app = await makeApp(tdb.db);
    const { me, channel } = await setup(app);
    // PATCH support for cascadeEnabled is added in Task 6; set via DB direct-write here.
    const { ObjectId } = await import('mongodb');
    const { collections } = await import('../src/db/types.js');
    await tdb.db.collection(collections.channels).updateOne(
      { _id: new ObjectId(channel.id) },
      { $set: { cascadeEnabled: false } }
    );

    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'find me AI papers' }, me.token);
    expect(post.body.replies.length).toBe(1);
    expect(post.body.replies[0].content).toContain('@critic');
  });
});
