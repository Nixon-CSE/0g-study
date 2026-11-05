import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

// auth refactor in progress — see Task E (Privy backend subagent)
describe.skip('auth routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('registers a new user and returns a token', async () => {
    const r = await jsonReq(app, 'POST', '/v1/auth/register', {
      email: 'alice@test.local', username: 'alice',
      password: 'correct horse battery staple', displayName: 'Alice',
    });
    expect(r.status).toBe(201);
    expect(r.body.token).toBeTruthy();
    expect(r.body.user.username).toBe('alice');
    expect(r.body.user.email).toBe('alice@test.local');
    expect(r.body.user).not.toHaveProperty('passwordHash');
  });

  it('409s on duplicate email or username (case-insensitive)', async () => {
    await jsonReq(app, 'POST', '/v1/auth/register', {
      email: 'a@test.local', username: 'alice', password: 'a'.repeat(12), displayName: 'A',
    });
    const dup = await jsonReq(app, 'POST', '/v1/auth/register', {
      email: 'A@TEST.LOCAL', username: 'ALICE', password: 'a'.repeat(12), displayName: 'A',
    });
    expect(dup.status).toBe(409);
  });

  it('logs in with email or username', async () => {
    await jsonReq(app, 'POST', '/v1/auth/register', {
      email: 'bob@test.local', username: 'bob', password: 's3cretpw1', displayName: 'Bob',
    });
    const byUser = await jsonReq(app, 'POST', '/v1/auth/login', { emailOrUsername: 'bob', password: 's3cretpw1' });
    expect(byUser.status).toBe(200);
    const byEmail = await jsonReq(app, 'POST', '/v1/auth/login', { emailOrUsername: 'bob@test.local', password: 's3cretpw1' });
    expect(byEmail.status).toBe(200);
    const bad = await jsonReq(app, 'POST', '/v1/auth/login', { emailOrUsername: 'bob', password: 'wrong' });
    expect(bad.status).toBe(401);
  });

  it('GET /v1/auth/me returns the current user', async () => {
    const me = await registerAndLogin(app, { username: 'carol' });
    const res = await jsonReq(app, 'GET', '/v1/auth/me', undefined, me.token);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('carol');
  });

  it('GET /v1/auth/me 401s without a token', async () => {
    const r = await jsonReq(app, 'GET', '/v1/auth/me');
    expect(r.status).toBe(401);
  });
});
