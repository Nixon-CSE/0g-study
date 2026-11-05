import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { serve } from '@hono/node-server';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';
import { collections } from '../src/db/types.js';

describe('audit log', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let agentServer: ReturnType<typeof serve>;
  let agentPort: number;

  beforeAll(async () => {
    tdb = await startTestDb();
    const fake = makeAgentFake({ reply: () => 'audit test reply' });
    agentServer = serve({ fetch: fake.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    agentPort = (agentServer.address() as any).port;
  });

  afterAll(async () => {
    agentServer.close();
    await stopTestDb();
  });

  beforeEach(async () => {
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
  });

  async function setupServerWithAgent() {
    const owner = await registerAndLogin(app, { username: 'alice' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'AuditTest', slug: 'auditserver' }, owner.token);
    expect(s.status).toBe(201);
    const serverId = s.body.server.id;

    const agentRes = await jsonReq(app, 'POST', '/v1/agents', {
      name: 'Auditor', slug: 'auditor',
      baseUrl: `http://127.0.0.1:${agentPort}`,
      description: 'audit test agent', tags: [], visibility: 'public',
    }, owner.token);
    expect(agentRes.status).toBe(201);
    const agentId = agentRes.body.agent.id;

    await jsonReq(app, 'POST', `/v1/servers/${serverId}/members`,
      { principalType: 'agent', principalId: agentId }, owner.token);

    // Get channels — find the text channel and the audit channel
    const chRes = await jsonReq(app, 'GET', `/v1/servers/${serverId}/channels`, undefined, owner.token);
    expect(chRes.status).toBe(200);
    const textChannel = chRes.body.channels.find((c: any) => c.type === 'text');
    const auditChannel = chRes.body.channels.find((c: any) => c.type === 'audit');

    // Set default agent on text channel
    await jsonReq(app, 'PATCH', `/v1/channels/${textChannel.id}`,
      { defaultAgentId: agentId }, owner.token);

    return { owner, serverId, textChannel, auditChannel, agentId };
  }

  it('invoking an agent writes agent_invoked and agent_replied rows', async () => {
    const { owner, textChannel } = await setupServerWithAgent();

    const r = await jsonReq(app, 'POST', `/v1/channels/${textChannel.id}/messages`,
      { content: 'hello audit' }, owner.token);
    expect(r.status).toBe(201);
    expect(r.body.replies.length).toBe(1);

    // Verify audit log rows were written to the DB
    const rows = await tdb.db.collection(collections.auditLog).find({}).toArray();
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const invoked = rows.find((row: any) => row.action === 'agent_invoked');
    expect(invoked).toBeDefined();
    expect(invoked.payload.inputPreview).toContain('hello audit');
    expect(invoked.agentSlug).toBe('auditor');

    const replied = rows.find((row: any) => row.action === 'agent_replied');
    expect(replied).toBeDefined();
    expect(replied.agentSlug).toBe('auditor');
    expect(typeof replied.payload.durationMs).toBe('number');
  });

  it('GET /v1/channels/:cid/audit returns entries for the server owner', async () => {
    const { owner, textChannel, auditChannel } = await setupServerWithAgent();

    // Send a message to generate audit entries
    await jsonReq(app, 'POST', `/v1/channels/${textChannel.id}/messages`,
      { content: 'trigger audit' }, owner.token);

    const r = await jsonReq(app, 'GET', `/v1/channels/${auditChannel.id}/audit`, undefined, owner.token);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(r.body.entries.length).toBeGreaterThanOrEqual(2);

    const entry = r.body.entries[0];
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('actorType');
    expect(entry).toHaveProperty('payload');
    expect(entry).toHaveProperty('createdAt');
  });

  it('non-owner gets 403 on audit channel', async () => {
    const { auditChannel } = await setupServerWithAgent();
    const bob = await registerAndLogin(app, { username: 'bob' });

    const r = await jsonReq(app, 'GET', `/v1/channels/${auditChannel.id}/audit`, undefined, bob.token);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('audit_owner_only');
  });

  it('returns 400 when channel is not an audit channel', async () => {
    const { owner, textChannel } = await setupServerWithAgent();
    const r = await jsonReq(app, 'GET', `/v1/channels/${textChannel.id}/audit`, undefined, owner.token);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('not_audit_channel');
  });

  it('respects limit and before query params', async () => {
    const { owner, textChannel, auditChannel } = await setupServerWithAgent();

    // Generate multiple audit entries
    for (let i = 0; i < 3; i++) {
      await jsonReq(app, 'POST', `/v1/channels/${textChannel.id}/messages`,
        { content: `message ${i}` }, owner.token);
    }

    const r1 = await jsonReq(app, 'GET', `/v1/channels/${auditChannel.id}/audit?limit=2`, undefined, owner.token);
    expect(r1.status).toBe(200);
    expect(r1.body.entries.length).toBeLessThanOrEqual(2);

    // before param: set to epoch to get zero results
    const r2 = await jsonReq(app, 'GET',
      `/v1/channels/${auditChannel.id}/audit?before=1970-01-01T00:00:00.000Z`,
      undefined, owner.token);
    expect(r2.status).toBe(200);
    expect(r2.body.entries.length).toBe(0);
  });
});
