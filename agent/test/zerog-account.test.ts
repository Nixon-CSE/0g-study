import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sealKeys, openKeys, validKeys, neuronTo0G, fetchBalance, saveUserKeys, loadUserKeys, accountsOffReason } from '../src/study/zerog-account.js';
import { withUserKey } from '../src/providers/zerog-router.js';
import { runWithContext } from '../src/runtime/request-context.js';
import { studyRoutes } from '../src/api/routes/study.js';

const SECRET = 'y'.repeat(40);
const KEYS = { apiKey: 'sk-user0000000000aaaa', managementKey: 'mk-user0000000000bbbb' };
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub: string) => {
  const h = enc({ alg: 'HS256' }), p = enc({ sub, exp: Math.floor(Date.now() / 1000) + 60 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-acct-'));
  process.env.STUDY_JWT_SECRET = SECRET;
  process.env.ZEROG_USER_ACCOUNTS = 'on';
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.STUDY_JWT_SECRET;
  delete process.env.ZEROG_USER_ACCOUNTS;
});

describe('user 0G keys at rest', () => {
  it('round-trips, and the file holds no plaintext key', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    expect(await loadUserKeys(dir, 'alice')).toEqual(KEYS);
    const raw = fs.readFileSync(path.join(dir, 'study', 'alice', 'zerog-keys.enc'), 'utf8');
    expect(raw).not.toContain('sk-user');
    expect(raw).not.toContain('mk-user');
  });
  it('rejects tampering and a different secret', () => {
    const blob = sealKeys(KEYS);
    const bad = Buffer.from(blob, 'base64'); bad[bad.length - 1] ^= 1;
    expect(openKeys(bad.toString('base64'))).toBeNull();
    process.env.STUDY_JWT_SECRET = 'z'.repeat(40);
    expect(openKeys(blob)).toBeNull();
  });
  it('loads nothing when the feature flag is off', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    delete process.env.ZEROG_USER_ACCOUNTS;
    expect(await loadUserKeys(dir, 'alice')).toBeNull();
  });
  it('validates key prefixes', () => {
    expect(validKeys(KEYS)).toBe(true);
    expect(validKeys({ apiKey: KEYS.managementKey, managementKey: KEYS.apiKey })).toBe(false);
    expect(validKeys({ apiKey: 'sk-short', managementKey: KEYS.managementKey })).toBe(false);
  });
});

describe('balance', () => {
  it('converts neuron to 0G', () => {
    expect(neuronTo0G('2000000000000000000')).toBe(2);
    expect(neuronTo0G('1234567000000000')).toBe(0.001234);
  });
  it('reads /account/balance with the management key', async () => {
    let auth = '';
    const f = (async (_u: any, init: any) => {
      auth = new Headers(init.headers).get('authorization')!;
      return new Response(JSON.stringify({ total_balance: '1500000000000000000' }), { headers: { 'content-type': 'application/json' } });
    }) as any;
    expect(await fetchBalance('mk-abc12345678', f)).toEqual({ ok: true, balance0G: 1.5, address: null });
    expect(auth).toBe('Bearer mk-abc12345678');
  });
  it('surfaces 403 insufficient_scope', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { code: 'insufficient_scope' } }), { status: 403 })) as any;
    expect(await fetchBalance('mk-abc12345678', f)).toEqual({ ok: false, status: 403, error: 'insufficient_scope' });
  });
});

describe('withUserKey', () => {
  it('swaps the Authorization header only for router calls in a turn with a user key', async () => {
    const seen: string[] = [];
    const f = withUserKey((async (u: any, init: any) => { seen.push(`${u}|${new Headers(init?.headers).get('authorization')}`); return new Response('{}'); }) as any);
    const shared = { headers: { authorization: 'Bearer sk-shared' } };
    await f('https://router-api.0g.ai/v1/chat/completions', shared);
    await runWithContext({ calls: [], zerogApiKey: 'sk-user0000000000aaaa' }, async () => {
      await f('https://router-api.0g.ai/v1/chat/completions', shared);
      await f('https://example.com/other', shared);
    });
    expect(seen).toEqual([
      'https://router-api.0g.ai/v1/chat/completions|Bearer sk-shared',
      'https://router-api.0g.ai/v1/chat/completions|Bearer sk-user0000000000aaaa',
      'https://example.com/other|Bearer sk-shared',
    ]);
  });
});

describe('/study/account routes', () => {
  const okBalance = async () => ({ ok: true as const, balance0G: 3.25, address: null });
  const listKeys = async () => ({ ok: true as const, keys: [{ preview: 'sk-user…', revoked: false, expiresAt: null }] });
  const auth = { authorization: `Bearer ${token('alice')}`, 'content-type': 'application/json' };

  it('connects, reports the balance, never returns the keys, and disconnects', async () => {
    const app = studyRoutes(dir, { balance: okBalance, listKeys });
    expect(await (await app.request('/study/account', { headers: auth })).json()).toEqual({ enabled: true, connected: false });
    const post = await app.request('/study/account', { method: 'POST', headers: auth, body: JSON.stringify(KEYS) });
    expect(post.status).toBe(200);
    const postBody = await post.text();
    expect(postBody).not.toContain('sk-user');
    const got = await (await app.request('/study/account', { headers: auth })).text();
    expect(JSON.parse(got)).toEqual({ enabled: true, connected: true, balance0G: 3.25 });
    expect(got).not.toContain('mk-user');
    await app.request('/study/account', { method: 'DELETE', headers: auth });
    expect(await loadUserKeys(dir, 'alice')).toBeNull();
  });

  it('refuses keys whose management key cannot read the balance', async () => {
    const app = studyRoutes(dir, { balance: async () => ({ ok: false as const, status: 403, error: 'insufficient_scope' }) });
    const r = await app.request('/study/account', { method: 'POST', headers: auth, body: JSON.stringify(KEYS) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('account:read');
    expect(await loadUserKeys(dir, 'alice')).toBeNull();
  });

  it('is off without the flag', async () => {
    delete process.env.ZEROG_USER_ACCOUNTS;
    const app = studyRoutes(dir, { balance: okBalance });
    expect(await (await app.request('/study/account', { headers: auth })).json()).toEqual({ enabled: false, connected: false });
    expect((await app.request('/study/account', { method: 'POST', headers: auth, body: JSON.stringify(KEYS) })).status).toBe(403);
  });
});

describe('enabled by default, off with a reason (P5-iAI step 1)', () => {
  it('needs the flag and STUDY_JWT_SECRET; the boot log gets the reason', () => {
    expect(accountsOffReason()).toBeNull();
    delete process.env.STUDY_JWT_SECRET;
    expect(accountsOffReason()).toMatch(/STUDY_JWT_SECRET is not set/);
    process.env.STUDY_JWT_SECRET = SECRET;
    process.env.ZEROG_USER_ACCOUNTS = 'off';
    expect(accountsOffReason()).toMatch(/ZEROG_USER_ACCOUNTS/);
  });
  it('the example env files turn it on', () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    expect(read('.env.example')).toMatch(/^ZEROG_USER_ACCOUNTS=on$/m);
    expect(read('../app/.env.local.example')).toMatch(/^NEXT_PUBLIC_ZEROG_ACCOUNTS=on$/m);
  });
});
