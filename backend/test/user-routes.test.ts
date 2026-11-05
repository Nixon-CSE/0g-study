import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

describe('user routes', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('GET /v1/users/:username returns the public profile', async () => {
    await registerAndLogin(app, { username: 'alice', displayName: 'Alice A' }, tdb.db);
    const r = await jsonReq(app, 'GET', '/v1/users/alice');
    expect(r.status).toBe(200);
    expect(r.body.user.username).toBe('alice');
    expect(r.body.user.displayName).toBe('Alice A');
    expect(r.body.user).not.toHaveProperty('email');
  });

  it('PATCH /v1/auth/me updates displayName and avatarUrl', async () => {
    const me = await registerAndLogin(app, { username: 'bob' });
    const r = await jsonReq(app, 'PATCH', '/v1/auth/me',
      { displayName: 'Bobby', avatarUrl: 'https://x.test/a.png', bio: 'hi' }, me.token);
    expect(r.status).toBe(200);
    expect(r.body.user.displayName).toBe('Bobby');
    expect(r.body.user.avatarUrl).toBe('https://x.test/a.png');
    expect(r.body.user.bio).toBe('hi');
  });

  it('PATCH /v1/auth/me/password is a no-op for Privy users (passwordHash is null)', async () => {
    // Privy users have no passwordHash; the password-change route returns 401 for them.
    const me = await registerAndLogin(app, { username: 'carol' });
    const bad = await jsonReq(app, 'PATCH', '/v1/auth/me/password',
      { currentPassword: 'wrong', newPassword: 'new-password-12' }, me.token);
    // passwordHash is null on Privy-provisioned users — route rejects with 401.
    expect(bad.status).toBe(401);
  });

  it('GET /v1/users/:username 404s for unknown user', async () => {
    const r = await jsonReq(app, 'GET', '/v1/users/nobody');
    expect(r.status).toBe(404);
  });
});
