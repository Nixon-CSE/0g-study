import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

describe('server routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('creates a server, owner member, and default channel', async () => {
    const me = await registerAndLogin(app, { username: 'alice' });
    const r = await jsonReq(app, 'POST', '/v1/servers',
      { name: 'Research Lab', slug: 'research-lab' }, me.token);
    expect(r.status).toBe(201);
    expect(r.body.server.slug).toBe('research-lab');
    expect(r.body.server.ownerId).toBe(me.user.id);
    expect(r.body.wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);

    const channels = await jsonReq(app, 'GET', `/v1/servers/${r.body.server.id}/channels`, undefined, me.token);
    expect(channels.status).toBe(200);
    // 4 auto-created: general (text), general-voice (voice), audit-log (audit), knowledge-base (knowledge)
    expect(channels.body.channels.length).toBe(4);
    expect(channels.body.channels.find((c: any) => c.name === 'general')).toBeDefined();
    expect(channels.body.channels.find((c: any) => c.type === 'knowledge')).toBeDefined();

    const members = await jsonReq(app, 'GET', `/v1/servers/${r.body.server.id}/members`, undefined, me.token);
    expect(members.body.members.length).toBe(1);
    expect(members.body.members[0].role).toBe('owner');
  });

  it('409s on duplicate slug', async () => {
    const me = await registerAndLogin(app);
    await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'dup' }, me.token);
    const r = await jsonReq(app, 'POST', '/v1/servers', { name: 'B', slug: 'dup' }, me.token);
    expect(r.status).toBe(409);
  });

  it('GET /v1/servers returns only servers I belong to', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const bobs = await jsonReq(app, 'GET', '/v1/servers', undefined, bob.token);
    expect(bobs.body.servers).toEqual([]);
  });

  it('non-member 403s on GET /v1/servers/:sid', async () => {
    const alice = await registerAndLogin(app, { username: 'alice' });
    const bob = await registerAndLogin(app, { username: 'bob' });
    const created = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a' }, alice.token);
    const r = await jsonReq(app, 'GET', `/v1/servers/${created.body.server.id}`, undefined, bob.token);
    expect(r.status).toBe(403);
  });
});
