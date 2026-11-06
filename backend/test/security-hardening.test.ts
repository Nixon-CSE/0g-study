/**
 * Security regression suite (added during ETHGlobal hardening).
 *  1. The agent admin token reaches ONLY the platform's own runtime — never an agent registered with
 *     someone else's baseUrl.
 *  2. Public MCP listings never expose env values (API keys).
 *  3. Cross-tenant isolation: a stranger cannot read/post into someone else's server or channel.
 *  4. Contract: a backend study token is accepted by the agent's verifier (same secret), and a token
 *     signed with any other secret is not.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq, TEST_JWT_SECRET } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { agentAdminHeaders, agentFetch, maskMcpServers, AGENT_ADMIN_HEADER } from '../src/agents/admin-token.js';
import { verifyHs256 } from '../../agent/src/study/auth.js';

const TOKEN = 'a'.repeat(64);

const clearAgentEnv = () => { delete process.env.AGENT_ADMIN_TOKEN; delete process.env.EMBER_AGENT_BASE_URL; };

describe('agentAdminHeaders', () => {
  beforeEach(clearAgentEnv);
  afterEach(() => { delete process.env.AGENT_ADMIN_TOKEN; delete process.env.EMBER_AGENT_BASE_URL; });

  it('sends nothing when no token is configured', () => {
    expect(agentAdminHeaders('http://localhost:7777/tenants')).toEqual({});
  });
  it('sends the token to the platform runtime only (same scheme, host and port)', () => {
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
    process.env.EMBER_AGENT_BASE_URL = 'https://agent.example.com';
    expect(agentAdminHeaders('https://agent.example.com/tenants/x')).toEqual({ [AGENT_ADMIN_HEADER]: TOKEN });
    expect(agentAdminHeaders('http://agent.example.com/tenants')).toEqual({});            // scheme downgrade
    expect(agentAdminHeaders('https://agent.example.com:8443/tenants')).toEqual({});      // other port
    expect(agentAdminHeaders('https://agent.example.com.evil.io/tenants')).toEqual({});   // suffix trick
    expect(agentAdminHeaders('https://evil.io/?u=https://agent.example.com')).toEqual({});
    expect(agentAdminHeaders('not a url')).toEqual({});
  });
  it('defaults the platform runtime to localhost:7777', () => {
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
    expect(agentAdminHeaders('http://localhost:7777/config')).toEqual({ [AGENT_ADMIN_HEADER]: TOKEN });
    expect(agentAdminHeaders('http://127.0.0.1:7777/config')).toEqual({});
  });
});

describe('agentFetch', () => {
  beforeEach(clearAgentEnv);
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.AGENT_ADMIN_TOKEN; });

  it('is byte-for-byte plain fetch when no header applies', async () => {
    const f = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', f);
    await agentFetch('http://x/config');
    expect(f).toHaveBeenCalledWith('http://x/config');
    const init = { method: 'POST', body: '{}' };
    await agentFetch('http://x/tenants', init);
    expect(f).toHaveBeenLastCalledWith('http://x/tenants', init);
  });
  it('merges the admin header without dropping caller headers', async () => {
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', f);
    await agentFetch('http://localhost:7777/tenants', { method: 'POST', headers: { 'content-type': 'application/json' } });
    const h = new Headers(f.mock.calls[0][1]!.headers);
    expect(h.get(AGENT_ADMIN_HEADER)).toBe(TOKEN);
    expect(h.get('content-type')).toBe('application/json');
    expect(f.mock.calls[0][1]!.method).toBe('POST');
  });
});

describe('maskMcpServers', () => {
  it('replaces every env value, keeps keys and other fields', () => {
    const out: any = maskMcpServers({ servers: { gh: { command: 'npx', args: ['x'], env: { GITHUB_TOKEN: 'ghp_secret', A: '1' }, enabled: true } } });
    expect(out.servers.gh).toEqual({ command: 'npx', args: ['x'], env: { GITHUB_TOKEN: '***', A: '***' }, enabled: true });
    expect(JSON.stringify(out)).not.toContain('ghp_secret');
  });
  it('tolerates missing env, empty, and non-object bodies', () => {
    expect((maskMcpServers({ servers: { a: { command: 'c' } } }) as any).servers.a.env).toEqual({});
    expect(maskMcpServers({ servers: {} })).toEqual({ servers: {} });
    expect(maskMcpServers('oops')).toBe('oops');
    expect(maskMcpServers(null)).toBe(null);
  });
});

/** Minimal fake agent runtime that records the admin header of every call. */
function fakeAgent() {
  const seen: { path: string; method: string; admin: string | null }[] = [];
  const app = new Hono();
  app.use('*', async (c, next) => { seen.push({ path: c.req.path, method: c.req.method, admin: c.req.header(AGENT_ADMIN_HEADER) ?? null }); await next(); });
  app.post('/tenants', async (c) => c.json({ tenant: await c.req.json() }, 201));
  app.get('/mcp/servers', (c) => c.json({ servers: { gh: { command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_live_secret' }, enabled: true } } }));
  app.post('/mcp/servers', (c) => c.json({ ok: true }));
  return { app, seen };
}

describe('backend → agent runtime (integration)', () => {
  let tdb: TestDb;
  let home: ReturnType<typeof fakeAgent>, evil: ReturnType<typeof fakeAgent>;
  let homeSrv: ReturnType<typeof serve>, evilSrv: ReturnType<typeof serve>;
  let homeUrl = '', evilUrl = '';

  beforeAll(async () => {
    tdb = await startTestDb();
    home = fakeAgent(); evil = fakeAgent();
    homeSrv = serve({ fetch: home.app.fetch, port: 0 });
    evilSrv = serve({ fetch: evil.app.fetch, port: 0 });
    await new Promise((r) => setTimeout(r, 50));
    homeUrl = `http://127.0.0.1:${(homeSrv.address() as any).port}`;
    evilUrl = `http://127.0.0.1:${(evilSrv.address() as any).port}`;
  });
  afterAll(async () => { homeSrv?.close(); evilSrv?.close(); await stopTestDb(); });
  beforeEach(async () => {
    await cleanCollections(tdb.db);
    home.seen.length = 0; evil.seen.length = 0;
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
    process.env.EMBER_AGENT_BASE_URL = homeUrl;
  });
  afterEach(() => { delete process.env.AGENT_ADMIN_TOKEN; delete process.env.EMBER_AGENT_BASE_URL; });

  const agentBody = (slug: string, baseUrl: string) => ({
    name: slug, slug, baseUrl, description: 'd', tags: [], visibility: 'public', soul: 'You are a test.', agents: '- be brief',
  });

  it('attaches the admin token when creating a tenant on the platform runtime', async () => {
    const app = await makeApp(tdb.db);
    const me = await registerAndLogin(app);
    const r = await jsonReq(app, 'POST', '/v1/agents', agentBody('homey', homeUrl), me.token);
    expect(r.status).toBe(201);
    const call = home.seen.find((s) => s.path === '/tenants' && s.method === 'POST');
    expect(call?.admin).toBe(TOKEN);
  });

  it('NEVER leaks the admin token to an agent registered with a foreign baseUrl', async () => {
    const app = await makeApp(tdb.db);
    const attacker = await registerAndLogin(app);
    const r = await jsonReq(app, 'POST', '/v1/agents', agentBody('trojan', evilUrl), attacker.token);
    expect(r.status).toBe(201);
    expect(evil.seen.length).toBeGreaterThan(0);
    expect(evil.seen.every((s) => s.admin === null)).toBe(true);
    // Every follow-up proxy path too.
    await jsonReq(app, 'GET', '/v1/agents/trojan/mcp/servers');
    await jsonReq(app, 'POST', '/v1/agents/trojan/mcp/servers', { id: 'x', command: 'echo' }, attacker.token);
    expect(evil.seen.every((s) => s.admin === null)).toBe(true);
  });

  it('public MCP listing masks secrets in env', async () => {
    const app = await makeApp(tdb.db);
    const me = await registerAndLogin(app);
    expect((await jsonReq(app, 'POST', '/v1/agents', agentBody('mcpy', homeUrl), me.token)).status).toBe(201);
    const r = await jsonReq(app, 'GET', '/v1/agents/mcpy/mcp/servers'); // no auth: public profile view
    expect(r.status).toBe(200);
    expect(r.body.servers.gh.env).toEqual({ GITHUB_TOKEN: '***' });
    expect(JSON.stringify(r.body)).not.toContain('ghp_live_secret');
  });

  it('only the owner may add an MCP server (which spawns a process on the runtime)', async () => {
    const app = await makeApp(tdb.db);
    const owner = await registerAndLogin(app);
    const stranger = await registerAndLogin(app);
    expect((await jsonReq(app, 'POST', '/v1/agents', agentBody('owned', homeUrl), owner.token)).status).toBe(201);
    const body = { id: 'pwn', command: 'bash', args: ['-c', 'id'] };
    expect((await jsonReq(app, 'POST', '/v1/agents/owned/mcp/servers', body)).status).toBe(401);
    expect((await jsonReq(app, 'POST', '/v1/agents/owned/mcp/servers', body, stranger.token)).status).toBe(403);
    expect(home.seen.some((s) => s.path === '/mcp/servers' && s.method === 'POST')).toBe(false);
    expect((await jsonReq(app, 'POST', '/v1/agents/owned/mcp/servers', body, owner.token)).status).toBe(200);
  });
});

describe('cross-tenant isolation', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); });

  it("a stranger cannot read, post to, or administer someone else's server", async () => {
    const app = await makeApp(tdb.db);
    const alice = await registerAndLogin(app);
    const mallory = await registerAndLogin(app);
    const created = await jsonReq(app, 'POST', '/v1/servers', { name: 'Study', slug: 'study-alice' }, alice.token);
    expect(created.status).toBe(201);
    const sid = created.body.server.id;
    const chans = await jsonReq(app, 'GET', `/v1/servers/${sid}/channels`, undefined, alice.token);
    expect(chans.status).toBe(200);
    const cid = chans.body.channels.find((c: any) => c.type !== 'voice')?.id ?? chans.body.channels[0].id;
    expect((await jsonReq(app, 'POST', `/v1/channels/${cid}/messages`, { content: 'secret notes' }, alice.token)).status).toBeLessThan(300);

    const denied = (s: number) => s === 403 || s === 404;
    expect(denied((await jsonReq(app, 'GET', `/v1/servers/${sid}`, undefined, mallory.token)).status)).toBe(true);
    expect(denied((await jsonReq(app, 'GET', `/v1/servers/${sid}/channels`, undefined, mallory.token)).status)).toBe(true);
    expect(denied((await jsonReq(app, 'GET', `/v1/servers/${sid}/members`, undefined, mallory.token)).status)).toBe(true);
    expect(denied((await jsonReq(app, 'GET', `/v1/servers/${sid}/wallet`, undefined, mallory.token)).status)).toBe(true);
    const read = await jsonReq(app, 'GET', `/v1/channels/${cid}/messages`, undefined, mallory.token);
    expect(denied(read.status)).toBe(true);
    expect(JSON.stringify(read.body)).not.toContain('secret notes');
    expect(denied((await jsonReq(app, 'POST', `/v1/channels/${cid}/messages`, { content: 'hi' }, mallory.token)).status)).toBe(true);
    expect(denied((await jsonReq(app, 'PATCH', `/v1/channels/${cid}`, { name: 'pwned' }, mallory.token)).status)).toBe(true);
    expect(denied((await jsonReq(app, 'DELETE', `/v1/servers/${sid}`, undefined, mallory.token)).status)).toBe(true);
    expect((await jsonReq(app, 'GET', `/v1/servers`, undefined, mallory.token)).body.servers).toEqual([]);
    // And with no token at all, everything is 401.
    for (const [m, p] of [['GET', `/v1/servers/${sid}`], ['GET', `/v1/channels/${cid}/messages`], ['POST', `/v1/channels/${cid}/messages`], ['GET', '/v1/auth/study-token']] as const) {
      expect((await jsonReq(app, m, p, m === 'POST' ? { content: 'x' } : undefined)).status).toBe(401);
    }
  });

  it('rejects malformed and forged Privy tokens', async () => {
    const app = await makeApp(tdb.db);
    for (const auth of ['Bearer ', 'Bearer garbage', 'Basic Zm9vOmJhcg==', 'bearer']) {
      const res = await app.fetch(new Request('http://test/v1/servers', { headers: { authorization: auth } }));
      expect(res.status).toBe(401);
    }
  });
});

describe('contract: backend study token ⇄ agent verifier', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });

  it('the agent accepts a backend-issued study token with the shared secret, and nothing else', async () => {
    await cleanCollections(tdb.db);
    const app = await makeApp(tdb.db);
    const me = await registerAndLogin(app);
    const r = await jsonReq(app, 'GET', '/v1/auth/study-token', undefined, me.token);
    expect(r.status).toBe(200);
    expect(verifyHs256(r.body.token, TEST_JWT_SECRET)).toBe(me.user.id);
    expect(verifyHs256(r.body.token, 'y'.repeat(32))).toBeNull();
    // Tampering with the payload (claiming another user) breaks the signature.
    const [h, p, s] = r.body.token.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'f'.repeat(24) })).toString('base64url');
    expect(verifyHs256(`${h}.${forged}.${s}`, TEST_JWT_SECRET)).toBeNull();
  });
});
