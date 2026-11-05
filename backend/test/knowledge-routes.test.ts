import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';

describe('knowledge-base routes + agent context injection', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let agentServer: ReturnType<typeof serve>;
  let agentPort: number;
  const seenInvocations: Array<{ userId: string; text: string }> = [];

  beforeAll(async () => {
    tdb = await startTestDb();
    const fake = makeAgentFake({
      reply: ({ userId, text }) => {
        seenInvocations.push({ userId, text });
        return `replied to: ${text.slice(0, 80)}`;
      },
    });
    agentServer = serve({ fetch: fake.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    agentPort = (agentServer.address() as { port: number }).port;
  });
  afterAll(async () => {
    agentServer.close();
    await stopTestDb();
  });
  beforeEach(async () => {
    seenInvocations.length = 0;
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
  });

  async function setupServerWithAgent() {
    const me = await registerAndLogin(app, { username: 'alice' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'KB Lab', slug: 'kb-lab' }, me.token);
    const agent = await jsonReq(
      app,
      'POST',
      '/v1/agents',
      {
        name: 'Researcher',
        slug: 'researcher',
        baseUrl: `http://127.0.0.1:${agentPort}`,
        description: 'x',
        tags: [],
        visibility: 'public',
      },
      me.token,
    );
    await jsonReq(
      app,
      'POST',
      `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'agent', principalId: agent.body.agent.id },
      me.token,
    );
    const ch = await jsonReq(
      app,
      'POST',
      `/v1/servers/${s.body.server.id}/channels`,
      { name: 'general-chat', defaultAgentId: agent.body.agent.id },
      me.token,
    );
    return { me, server: s.body.server, channel: ch.body.channel, agent: agent.body.agent };
  }

  it('auto-creates a knowledge-base channel on every new server', async () => {
    const { server, me } = await setupServerWithAgent();
    const channels = await jsonReq(app, 'GET', `/v1/servers/${server.id}/channels`, undefined, me.token);
    const kb = channels.body.channels.find((c: { type: string; name: string }) => c.type === 'knowledge');
    expect(kb).toBeDefined();
    expect(kb.name).toBe('knowledge-base');
  });

  it('round-trips a typed document via POST + GET + LIST + DELETE', async () => {
    const { server, me } = await setupServerWithAgent();
    const created = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      { title: 'Onboarding playbook', content: 'Always greet new members with their first name.' },
      me.token,
    );
    expect(created.status).toBe(201);
    expect(created.body.doc.title).toBe('Onboarding playbook');
    expect(created.body.doc.source).toBe('inline');
    expect(created.body.doc.sizeBytes).toBeGreaterThan(0);

    const list = await jsonReq(app, 'GET', `/v1/servers/${server.id}/knowledge`, undefined, me.token);
    expect(list.status).toBe(200);
    expect(list.body.docs.length).toBe(1);

    const got = await jsonReq(app, 'GET', `/v1/servers/${server.id}/knowledge/${created.body.doc.id}`, undefined, me.token);
    expect(got.status).toBe(200);
    expect(got.body.doc.content).toContain('greet new members');

    const del = await jsonReq(app, 'DELETE', `/v1/servers/${server.id}/knowledge/${created.body.doc.id}`, undefined, me.token);
    expect(del.status).toBe(200);

    const listAfter = await jsonReq(app, 'GET', `/v1/servers/${server.id}/knowledge`, undefined, me.token);
    expect(listAfter.body.docs.length).toBe(0);
  });

  it('rejects empty/invalid body on POST', async () => {
    const { server, me } = await setupServerWithAgent();
    const bad = await jsonReq(app, 'POST', `/v1/servers/${server.id}/knowledge`, { title: '' }, me.token);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_body');
  });

  it('forbids non-members from listing/creating', async () => {
    const { server } = await setupServerWithAgent();
    const bob = await registerAndLogin(app, { username: 'bob' });
    const list = await jsonReq(app, 'GET', `/v1/servers/${server.id}/knowledge`, undefined, bob.token);
    expect(list.status).toBe(403);
    const create = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      { title: 'hi', content: 'hi' },
      bob.token,
    );
    expect(create.status).toBe(403);
  });

  it('injects the knowledge block into the text the agent receives', async () => {
    const { me, server, channel } = await setupServerWithAgent();
    await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      {
        title: 'Product facts',
        content: 'The product code-name is "Aurora" and ships on 2026-06-01.',
      },
      me.token,
    );

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel.id}/messages`,
      { content: 'When does it ship?' },
      me.token,
    );
    expect(r.status).toBe(201);
    expect(seenInvocations.length).toBe(1);

    const sent = seenInvocations[0].text;
    // The block is prepended to the user's text, not persisted on the user message.
    expect(sent).toContain('<knowledge_base>');
    expect(sent).toContain('Product facts');
    expect(sent).toContain('Aurora');
    expect(sent).toContain('2026-06-01');
    expect(sent).toContain('When does it ship?');

    // The persisted user message must NOT contain the knowledge block.
    expect(r.body.userMessage.content).toBe('When does it ship?');
    expect(r.body.userMessage.content).not.toContain('<knowledge_base>');
  });

  it('omits the knowledge block when the server has no docs', async () => {
    const { me, channel } = await setupServerWithAgent();
    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel.id}/messages`,
      { content: 'plain question' },
      me.token,
    );
    expect(r.status).toBe(201);
    expect(seenInvocations.length).toBe(1);
    expect(seenInvocations[0].text).not.toContain('<knowledge_base>');
    expect(seenInvocations[0].text).toContain('plain question');
  });

  it('search endpoint returns documents matching a query', async () => {
    const { me, server } = await setupServerWithAgent();
    await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      { title: 'Pricing', content: 'Standard tier is $9/mo, Pro is $29/mo, Enterprise is custom.' },
      me.token,
    );
    await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      { title: 'Support hours', content: 'We staff Mon-Fri 9am-5pm PT. Weekends are best-effort.' },
      me.token,
    );

    const r = await jsonReq(
      app,
      'GET',
      `/v1/servers/${server.id}/knowledge/search?q=pricing`,
      undefined,
      me.token,
    );
    expect(r.status).toBe(200);
    expect(r.body.results.length).toBeGreaterThan(0);
    expect(r.body.results[0].title).toBe('Pricing');
    expect(r.body.results[0].snippet).toContain('$9');
  });
});
