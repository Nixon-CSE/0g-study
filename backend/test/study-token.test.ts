import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq, TEST_JWT_SECRET } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { verifyToken } from '../src/auth/jwt.js';

describe('GET /v1/auth/study-token (NFR1)', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); app = await makeApp(tdb.db); });

  it('401s without a Privy token', async () => {
    expect((await jsonReq(app, 'GET', '/v1/auth/study-token')).status).toBe(401);
  });

  it('issues an HS256 token whose sub is the Mongo user id', async () => {
    const me = await registerAndLogin(app);
    const r = await jsonReq(app, 'GET', '/v1/auth/study-token', undefined, me.token);
    expect(r.status).toBe(200);
    expect(r.body.expiresIn).toBe(3600);
    const claims = await verifyToken(r.body.token, TEST_JWT_SECRET);
    expect(claims.sub).toBe(me.user.id);
    expect(claims.sub).toMatch(/^[a-f0-9]{24}$/);
  });
});
