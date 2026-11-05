/**
 * Tests for Privy-based auth routes and middleware.
 *
 * The @privy-io/server-auth mock is set up globally in test/setup/privy-mock.ts
 * (loaded via vitest setupFiles). No real network calls are made.
 *
 * Mock token format: "mock-token:<privyDid>"
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { provisionTestUser, mockPrivyAuthFor } from './util/auth.js';

const MOCK_DID = 'did:privy:test-abc123';
const MOCK_TOKEN = mockPrivyAuthFor(MOCK_DID);
// These must match what the global mock returns (see test/setup/privy-mock.ts).
const MOCK_WALLET = '0xDEAD000000000000000000000000000000000001';
const MOCK_EMAIL = `${MOCK_DID.replace(/[^a-z0-9]/gi, '-')}@mock.privy.test`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Privy auth routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/privy/verify — happy path (first call creates user)
  // -------------------------------------------------------------------------

  it('POST /v1/auth/privy/verify with valid token returns 200 and UserDoc', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });
    expect(r.status).toBe(200);
    expect(r.body.user).toBeDefined();
    expect(r.body.user.email).toBe(MOCK_EMAIL);
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/privy/verify — idempotency (second call returns same user)
  // -------------------------------------------------------------------------

  it('second POST /v1/auth/privy/verify with same token returns the same UserDoc', async () => {
    const r1 = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });
    const r2 = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Same user id on both calls — no duplicate insert.
    expect(r1.body.user.id).toBe(r2.body.user.id);
  });

  it('POST /v1/auth/privy/verify does not overwrite displayName after PATCH /v1/auth/me', async () => {
    const v1 = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });
    expect(v1.status).toBe(200);

    const patch = await jsonReq(app, 'PATCH', '/v1/auth/me',
      { displayName: 'Custom Namu' }, MOCK_TOKEN);
    expect(patch.status).toBe(200);
    expect(patch.body.user.displayName).toBe('Custom Namu');

    const v2 = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });
    expect(v2.status).toBe(200);
    expect(v2.body.user.displayName).toBe('Custom Namu');
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/privy/verify — invalid token
  // -------------------------------------------------------------------------

  it('POST /v1/auth/privy/verify with invalid token returns 401', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: 'not-a-valid-token' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('unauthorized');
  });

  // -------------------------------------------------------------------------
  // GET /v1/auth/me — protected endpoint
  // -------------------------------------------------------------------------

  it('GET /v1/auth/me with valid token returns the current user', async () => {
    // First verify to provision the user, then hit /me directly.
    const verify = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token: MOCK_TOKEN });
    expect(verify.status).toBe(200);

    const me = await jsonReq(app, 'GET', '/v1/auth/me', undefined, MOCK_TOKEN);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(MOCK_EMAIL);
  });

  it('GET /v1/auth/me without a token returns 401', async () => {
    const r = await jsonReq(app, 'GET', '/v1/auth/me');
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('unauthorized');
  });

  it('GET /v1/auth/me with invalid token returns 401', async () => {
    const r = await jsonReq(app, 'GET', '/v1/auth/me', undefined, 'garbage-token');
    expect(r.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // Legacy routes — 410 Gone
  // -------------------------------------------------------------------------

  it('POST /v1/auth/login returns 410 Gone with migration hint', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/login', {
      emailOrUsername: 'alice',
      password: 'hunter2',
    });
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('deprecated');
    expect(r.body.migration).toMatch(/privy/i);
  });

  it('POST /v1/auth/register returns 410 Gone', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/register', {
      email: 'x@test.local', username: 'x', password: 'passw0rd', displayName: 'X',
    });
    expect(r.status).toBe(410);
    expect(r.body.error).toBe('deprecated');
  });

  // -------------------------------------------------------------------------
  // POST /v1/auth/logout — no-op
  // -------------------------------------------------------------------------

  it('POST /v1/auth/logout returns 204', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/logout');
    expect(r.status).toBe(204);
  });

  // -------------------------------------------------------------------------
  // provisionTestUser helper — direct DB insert works
  // -------------------------------------------------------------------------

  it('provisionTestUser inserts a user that GET /v1/auth/me can resolve', async () => {
    const did = 'did:privy:test-provision-123';
    const token = mockPrivyAuthFor(did);

    // Insert user directly (simulates what a real Privy flow would do).
    const user = await provisionTestUser(tdb.db, { privyDid: did });
    expect(user.privyDid).toBe(did);

    // /me resolves via middleware upsert — finds existing user.
    const me = await jsonReq(app, 'GET', '/v1/auth/me', undefined, token);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(user._id.toHexString());
  });
});
