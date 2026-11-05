import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';

/**
 * "Private (TEE)" channel contract:
 *   - Creating with tee:true returns tee=true and a non-empty teeAttestationHash.
 *   - The shared knowledge base is NOT injected into the agent's prompt text.
 *   - The agent reply persists with a per-message teeHash.
 *   - Same channel created without tee:true behaves normally (knowledge injected,
 *     no teeHash on replies) — this catches regressions where the gate leaks.
 */
describe('TEE-attested channels', () => {
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
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'TEE Lab', slug: 'tee-lab' }, me.token);
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
    return { me, server: s.body.server, agent: agent.body.agent };
  }

  it('POST /channels with tee:true returns a deterministic attestation hash', async () => {
    const { me, server, agent } = await setupServerWithAgent();
    const r = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'private-room', defaultAgentId: agent.id, tee: true },
      me.token,
    );
    expect(r.status).toBe(201);
    expect(r.body.channel.tee).toBe(true);
    expect(typeof r.body.channel.teeAttestationHash).toBe('string');
    expect(r.body.channel.teeAttestationHash).toMatch(/^[a-f0-9]{64}$/);

    const r2 = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'plain-room', defaultAgentId: agent.id },
      me.token,
    );
    expect(r2.status).toBe(201);
    expect(r2.body.channel.tee).toBe(false);
    expect(r2.body.channel.teeAttestationHash).toBeNull();
  });

  it('SKIPS knowledge injection in TEE channels even when docs exist', async () => {
    const { me, server, agent } = await setupServerWithAgent();
    // Seed shared knowledge that would normally appear in the agent prompt.
    await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/knowledge`,
      { title: 'Secret-product-code', content: 'The internal code-name is "Phoenix".' },
      me.token,
    );

    // Plain text channel: knowledge SHOULD reach the agent.
    const plainCh = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'plain', defaultAgentId: agent.id },
      me.token,
    );
    await jsonReq(
      app,
      'POST',
      `/v1/channels/${plainCh.body.channel.id}/messages`,
      { content: 'ping plain' },
      me.token,
    );
    const plainText = seenInvocations.at(-1)!.text;
    expect(plainText).toContain('<knowledge_base>');
    expect(plainText).toContain('Phoenix');

    // TEE channel: knowledge MUST NOT reach the agent.
    const teeCh = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'private', defaultAgentId: agent.id, tee: true },
      me.token,
    );
    await jsonReq(
      app,
      'POST',
      `/v1/channels/${teeCh.body.channel.id}/messages`,
      { content: 'ping private' },
      me.token,
    );
    const teeText = seenInvocations.at(-1)!.text;
    expect(teeText).not.toContain('<knowledge_base>');
    expect(teeText).not.toContain('Phoenix');
    expect(teeText).toContain('ping private');
  });

  it('stamps a teeHash on agent replies in TEE channels (but not on plain replies)', async () => {
    const { me, server, agent } = await setupServerWithAgent();

    const teeCh = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'private', defaultAgentId: agent.id, tee: true },
      me.token,
    );
    const r1 = await jsonReq(
      app,
      'POST',
      `/v1/channels/${teeCh.body.channel.id}/messages`,
      { content: 'hello' },
      me.token,
    );
    expect(r1.status).toBe(201);
    expect(r1.body.replies.length).toBe(1);
    expect(typeof r1.body.replies[0].teeHash).toBe('string');
    expect(r1.body.replies[0].teeHash).toMatch(/^[a-f0-9]{64}$/);

    const plainCh = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'plain', defaultAgentId: agent.id },
      me.token,
    );
    const r2 = await jsonReq(
      app,
      'POST',
      `/v1/channels/${plainCh.body.channel.id}/messages`,
      { content: 'hello' },
      me.token,
    );
    expect(r2.body.replies[0].teeHash).toBeNull();
  });

  it('each reply in a TEE channel gets a unique teeHash', async () => {
    const { me, server, agent } = await setupServerWithAgent();
    const ch = await jsonReq(
      app,
      'POST',
      `/v1/servers/${server.id}/channels`,
      { name: 'private', defaultAgentId: agent.id, tee: true },
      me.token,
    );
    const r1 = await jsonReq(
      app,
      'POST',
      `/v1/channels/${ch.body.channel.id}/messages`,
      { content: 'one' },
      me.token,
    );
    const r2 = await jsonReq(
      app,
      'POST',
      `/v1/channels/${ch.body.channel.id}/messages`,
      { content: 'two' },
      me.token,
    );
    expect(r1.body.replies[0].teeHash).not.toBe(r2.body.replies[0].teeHash);
  });
});
