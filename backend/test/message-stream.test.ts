import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';

describe('message streaming', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let agentServer: ReturnType<typeof serve>;
  let agentPort: number;

  beforeAll(async () => {
    tdb = await startTestDb();
    const fake = makeAgentFake({ reply: ({ text }) => `streamed: ${text}` });
    agentServer = serve({ fetch: fake.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    agentPort = (agentServer.address() as any).port;
  });
  afterAll(async () => { agentServer.close(); await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  async function setupChannelWithAgent() {
    const me = await registerAndLogin(app, { username: 'alice' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, me.token);
    const agent = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'R', slug: 'researcher', baseUrl: `http://127.0.0.1:${agentPort}`,
      description: 'x', tags: [], visibility: 'public',
    }, me.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'agent', principalId: agent.body.agent.id }, me.token);
    const ch = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`,
      { name: 'research', defaultAgentId: agent.body.agent.id }, me.token);
    return { me, channel: ch.body.channel };
  }

  it('returns streamIds when stream:true and persists final message on close', async () => {
    const { me, channel } = await setupChannelWithAgent();
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'hello', stream: true }, me.token);
    expect(post.status).toBe(201);
    expect(post.body.replies).toEqual([]);
    expect(post.body.streamIds.length).toBe(1);

    const sid = post.body.streamIds[0];
    const res = await app.fetch(new Request(`http://test/v1/channels/${channel.id}/stream/${sid}`, {
      headers: { authorization: `Bearer ${me.token}` },
    }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('streamed: hello');

    const list = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages`, undefined, me.token);
    expect(list.body.messages.some((m: any) => m.authorType === 'agent' && m.content === 'streamed: hello')).toBe(true);
  });

  it('subscribing twice fails (single-use stream)', async () => {
    const { me, channel } = await setupChannelWithAgent();
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'x', stream: true }, me.token);
    const sid = post.body.streamIds[0];
    await app.fetch(new Request(`http://test/v1/channels/${channel.id}/stream/${sid}`, {
      headers: { authorization: `Bearer ${me.token}` },
    })).then(r => r.text());
    const again = await app.fetch(new Request(`http://test/v1/channels/${channel.id}/stream/${sid}`, {
      headers: { authorization: `Bearer ${me.token}` },
    }));
    expect(again.status).toBe(404);
  });
});
