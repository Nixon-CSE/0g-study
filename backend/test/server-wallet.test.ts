import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ethers } from 'ethers';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { createServerWallet } from '../src/servers/wallet.js';

describe('createServerWallet', () => {
  it('produces a valid ethers wallet', () => {
    const w = createServerWallet();
    expect(w.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(w.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(w.network).toBe('og-testnet');
    // Round-trip through ethers to confirm key is genuine
    const v = new ethers.Wallet(w.privateKey);
    expect(v.address).toBe(w.address);
  });

  it('produces distinct wallets on each call', () => {
    const a = createServerWallet();
    const b = createServerWallet();
    expect(a.address).not.toBe(b.address);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

describe('server wallet endpoints', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('POST /v1/servers returns a wallet with address + privateKey + funding metadata', async () => {
    const me = await registerAndLogin(app);
    const r = await jsonReq(app, 'POST', '/v1/servers', { name: 'W', slug: 'walletest' }, me.token);
    expect(r.status).toBe(201);
    expect(r.body.wallet.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(r.body.wallet.privateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(r.body.wallet.network).toBe('og-testnet');
    expect(r.body.funding.faucetUrl).toContain('0g.ai');
    expect(r.body.funding.tokenSymbol).toBe('OG');

    // publicServer should NOT expose the wallet
    expect(r.body.server).not.toHaveProperty('wallet');
  });

  it('GET /v1/servers/:sid/wallet returns the wallet for the owner', async () => {
    const me = await registerAndLogin(app);
    const created = await jsonReq(app, 'POST', '/v1/servers', { name: 'W', slug: 'walletest2' }, me.token);
    const sid = created.body.server.id;

    const r = await jsonReq(app, 'GET', `/v1/servers/${sid}/wallet`, undefined, me.token);
    expect(r.status).toBe(200);
    expect(r.body.wallet.address).toBe(created.body.wallet.address);
    expect(r.body.wallet.privateKey).toBe(created.body.wallet.privateKey);
    // balance may be null if RPC unreachable; that's fine, just make sure the key is present
    expect(r.body).toHaveProperty('balance');
  });

  it('GET wallet 403s for non-admin members', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-w' });
    const bob = await registerAndLogin(app, { username: 'bob-w' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'W', slug: 'walletest3' }, alice.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`,
      { principalType: 'user', principalId: bob.user.id }, alice.token);

    const r = await jsonReq(app, 'GET', `/v1/servers/${s.body.server.id}/wallet`, undefined, bob.token);
    expect(r.status).toBe(403);
  });
});
