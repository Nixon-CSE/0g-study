import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

/**
 * Fake agent that imitates an MCP-equipped agent. When invoked, it:
 *   1. Calls BonFire's /v1/internal/peers to discover other agents in the channel's server
 *   2. Picks the first peer that isn't itself
 *   3. Returns a reply that @-mentions that peer
 *
 * The cascade engine should then invoke the @-mentioned peer.
 *
 * The fake holds:
 *   - its slug (so it knows its own identity)
 *   - bonfireBaseUrl + agentKey (to call /v1/internal)
 *   - channelId (passed in via the chatId in the inbound message)
 */
function makeDiscoveringAgent(opts: {
  slug: string;
  bonfireBaseUrl: () => string;
  agentKey: () => string;
  fallbackReply: string;
}) {
  const app = new Hono();
  const pending = new Map<string, string>();

  app.post('/chat/message', async (c) => {
    const body = await c.req.json();
    const userId: string = body.userId ?? '';
    // chatId format: bonfire:channel:<hex>
    const channelId = userId.startsWith('bonfire:channel:') ? userId.slice('bonfire:channel:'.length) : null;

    let reply = opts.fallbackReply;
    if (channelId) {
      try {
        const peersRes = await fetch(`${opts.bonfireBaseUrl()}/v1/internal/peers?channelId=${channelId}`, {
          headers: { 'x-bonfire-agent-key': opts.agentKey() },
        });
        if (peersRes.ok) {
          const data: any = await peersRes.json();
          const others = (data.agents ?? []).filter((a: any) => a.slug !== opts.slug);
          if (others.length > 0) {
            reply = `discovered peers via mcp-style call: @${others[0].slug} please continue`;
          }
        }
      } catch { /* fall through to fallback */ }
    }

    const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(streamId, reply);
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

/** Simple terminator agent — replies with a fixed string, no @-mentions. */
function makeTerminatorAgent(reply: string) {
  const app = new Hono();
  const pending = new Map<string, string>();
  app.post('/chat/message', async (c) => {
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(id, reply);
    return c.json({ streamId: id });
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

describe('cascade via mcp-style peer discovery', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;

  // We need the BonFire HTTP server running so the fake agent can call /v1/internal/peers.
  let bonfireServer: ReturnType<typeof serve>;
  let bonfirePort: number;
  let bonfireBaseUrl = '';

  // Agent process servers.
  const agentServers: ReturnType<typeof serve>[] = [];
  const ports: Record<string, number> = {};

  // The discovering agent needs to know its own key. We set it after registration.
  let researcherKey = '';

  beforeAll(async () => {
    tdb = await startTestDb();
    app = await makeApp(tdb.db);

    // Bring BonFire app up on a real port so the agent fake can fetch /v1/internal/peers.
    bonfireServer = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    bonfirePort = (bonfireServer.address() as any).port;
    bonfireBaseUrl = `http://127.0.0.1:${bonfirePort}`;

    // Stand up two agent process servers.
    const researcher = serve({
      fetch: makeDiscoveringAgent({
        slug: 'researcher',
        bonfireBaseUrl: () => bonfireBaseUrl,
        agentKey: () => researcherKey,
        fallbackReply: 'no peers found',
      }).fetch,
      port: 0,
    });
    const critic = serve({ fetch: makeTerminatorAgent('I disagree — see issue 42.').fetch, port: 0 });
    agentServers.push(researcher, critic);
    await new Promise<void>((r) => setTimeout(r, 50));
    ports.researcher = (researcher.address() as any).port;
    ports.critic = (critic.address() as any).port;
  });

  afterAll(async () => {
    agentServers.forEach(s => s.close());
    bonfireServer.close();
    await stopTestDb();
  });

  beforeEach(async () => { await cleanCollections(tdb.db); });

  it('researcher discovers @critic via internal API, mentions them, critic replies, full transcript visible', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'X', slug: 'x' }, alice.token);
    const researcherReg = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Researcher', slug: 'researcher',
      baseUrl: `http://127.0.0.1:${ports.researcher}`,
      description: 'finds papers', tags: [], visibility: 'public',
    }, alice.token);
    const criticReg = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Critic', slug: 'critic',
      baseUrl: `http://127.0.0.1:${ports.critic}`,
      description: 'critiques', tags: [], visibility: 'public',
    }, alice.token);

    // Capture the researcher's agentKey so its fake can authenticate to /v1/internal/peers.
    researcherKey = researcherReg.body.agentKey;
    expect(researcherKey).toMatch(/^bka_[a-f0-9]+$/);

    await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`,
      { principalType: 'agent', principalId: researcherReg.body.agent.id }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`,
      { principalType: 'agent', principalId: criticReg.body.agent.id }, alice.token);
    const ch = await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/channels`,
      { name: 'research', defaultAgentId: researcherReg.body.agent.id }, alice.token);

    const post = await jsonReq(app, 'POST', `/v1/channels/${ch.body.channel.id}/messages`,
      { content: 'find me AI papers' }, alice.token);

    expect(post.status).toBe(201);
    // Researcher's reply (after discovery) mentions @critic; critic's reply terminates.
    expect(post.body.replies.length).toBe(2);
    expect(post.body.replies[0].content).toContain('@critic');
    expect(post.body.replies[1].content).toContain('issue 42');

    // Full transcript visible.
    const list = await jsonReq(app, 'GET', `/v1/channels/${ch.body.channel.id}/messages?limit=20`, undefined, alice.token);
    const contents = list.body.messages.map((m: any) => m.content);
    expect(contents.find((s: string) => s === 'find me AI papers')).toBeTruthy();
    expect(contents.find((s: string) => s.includes('@critic'))).toBeTruthy();
    expect(contents.find((s: string) => s.includes('issue 42'))).toBeTruthy();
  });
});
