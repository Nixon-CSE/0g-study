import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';

describe('message routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let agentServer: ReturnType<typeof serve>;
  let agentPort: number;
  const seenInvocations: Array<{ userId: string; text: string }> = [];

  beforeAll(async () => {
    tdb = await startTestDb();
    const fake = makeAgentFake({ reply: ({ userId, text }) => { seenInvocations.push({ userId, text }); return `replied to: ${text}`; } });
    agentServer = serve({ fetch: fake.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    agentPort = (agentServer.address() as any).port;
  });
  afterAll(async () => { agentServer.close(); await stopTestDb(); });
  beforeEach(async () => {
    seenInvocations.length = 0;
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
  });

  async function setupChannelWithAgent(opts: { mentionInsteadOfDefault?: boolean } = {}) {
    const me = await registerAndLogin(app, { username: 'alice' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, me.token);
    const agent = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Researcher', slug: 'researcher', baseUrl: `http://127.0.0.1:${agentPort}`,
      description: 'x', tags: [], visibility: 'public',
    }, me.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'agent', principalId: agent.body.agent.id }, me.token);
    const chBody: any = { name: 'research' };
    if (!opts.mentionInsteadOfDefault) chBody.defaultAgentId = agent.body.agent.id;
    const ch = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`, chBody, me.token);
    return { me, server: s.body.server, channel: ch.body.channel, agent: agent.body.agent };
  }

  it('persists the user message and the default agent reply', async () => {
    const { me, channel } = await setupChannelWithAgent();
    const r = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'find me papers on AI' }, me.token);
    expect(r.status).toBe(201);
    expect(r.body.userMessage.content).toBe('find me papers on AI');
    expect(r.body.replies.length).toBe(1);
    expect(r.body.replies[0].authorType).toBe('agent');
    // The invocation text now includes an author-attribution preamble; the fake agent echoes it.
    expect(r.body.replies[0].content).toContain('find me papers on AI');

    const list = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages`, undefined, me.token);
    expect(list.body.messages.length).toBe(2);
  });

  it('invokes only mentioned agents when no default', async () => {
    const { me, channel } = await setupChannelWithAgent({ mentionInsteadOfDefault: true });
    const r1 = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'plain chat' }, me.token);
    expect(r1.body.replies.length).toBe(0);

    const r2 = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: 'hello @researcher please help' }, me.token);
    expect(r2.body.replies.length).toBe(1);
  });

  it('uses a channel-scoped chatId for the agent', async () => {
    const { me, channel } = await setupChannelWithAgent();
    await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: 'one' }, me.token);
    await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: 'two' }, me.token);
    expect(seenInvocations.every(i => i.userId === `bonfire:channel:${channel.id}`)).toBe(true);
  });

  it('paginates messages with before=', async () => {
    const { me, channel } = await setupChannelWithAgent({ mentionInsteadOfDefault: true });
    for (let i = 0; i < 5; i++) {
      await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: `m${i}` }, me.token);
    }
    const page1 = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages?limit=2`, undefined, me.token);
    expect(page1.body.messages.length).toBe(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages?limit=2&before=${page1.body.nextCursor}`, undefined, me.token);
    expect(page2.body.messages.length).toBe(2);
  });

  it('non-member 403s on POST', async () => {
    const { channel } = await setupChannelWithAgent();
    const bob = await registerAndLogin(app, { username: 'bob' });
    const r = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: 'hi' }, bob.token);
    expect(r.status).toBe(403);
  });

  it('author can delete their own message', async () => {
    const { me, channel } = await setupChannelWithAgent({ mentionInsteadOfDefault: true });
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: 'delete me' }, me.token);
    const r = await jsonReq(app, 'DELETE', `/v1/messages/${post.body.userMessage.id}`, undefined, me.token);
    expect(r.status).toBe(200);
    const list = await jsonReq(app, 'GET', `/v1/channels/${channel.id}/messages`, undefined, me.token);
    expect(list.body.messages.find((m: any) => m.id === post.body.userMessage.id)).toBeUndefined();
  });
});
