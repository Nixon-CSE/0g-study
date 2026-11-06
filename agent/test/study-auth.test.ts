import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyHs256, takeUploadSlot, resetUploadCounts } from '../src/study/auth.js';
import { studyRoutes } from '../src/api/routes/study.js';
import { makeTracedFetch, resetRouterTrace } from '../src/providers/zerog-router.js';
import { runWithContext } from '../src/runtime/request-context.js';

const SECRET = 'x'.repeat(40);
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload: object, secret = SECRET, header: object = { alg: 'HS256', typ: 'JWT' }) {
  const h = enc(header), p = enc(payload);
  const s = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}
const now = Math.floor(Date.now() / 1000);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('verifyHs256', () => {
  it('accepts a valid token and returns sub', () => {
    expect(verifyHs256(sign({ sub: 'abc123', exp: now + 60 }), SECRET)).toBe('abc123');
  });
  it('rejects wrong secret, expired, alg none, malformed, unsafe sub', () => {
    expect(verifyHs256(sign({ sub: 'abc', exp: now + 60 }, 'other-secret'), SECRET)).toBeNull();
    expect(verifyHs256(sign({ sub: 'abc', exp: now - 1 }), SECRET)).toBeNull();
    expect(verifyHs256(sign({ sub: 'abc' }, SECRET, { alg: 'none' }), SECRET)).toBeNull();
    expect(verifyHs256('not.a.jwt', SECRET)).toBeNull();
    expect(verifyHs256('garbage', SECRET)).toBeNull();
    expect(verifyHs256(sign({ sub: '../etc', exp: now + 60 }), SECRET)).toBeNull();
  });
});

describe('takeUploadSlot', () => {
  beforeEach(() => { resetUploadCounts(); process.env.STUDY_DAILY_UPLOAD_CAP = '2'; });
  afterEach(() => { delete process.env.STUDY_DAILY_UPLOAD_CAP; });
  it('caps per user per day, independently', () => {
    const d = new Date('2026-11-05T10:00:00Z');
    expect(takeUploadSlot('a', d)).toBe(true);
    expect(takeUploadSlot('a', d)).toBe(true);
    expect(takeUploadSlot('a', d)).toBe(false);
    expect(takeUploadSlot('b', d)).toBe(true);
    expect(takeUploadSlot('a', new Date('2026-11-06T10:00:00Z'))).toBe(true);
  });
});

describe('study routes auth (NFR1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-auth-'));
    resetUploadCounts();
    process.env.STUDY_JWT_SECRET = SECRET;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.STUDY_JWT_SECRET;
    delete process.env.STUDY_ALLOWED_ORIGINS;
  });

  it('rejects requests without a valid token', async () => {
    const app = studyRoutes(dir);
    expect((await app.request('/usage')).status).toBe(401);
    expect((await app.request('/study/index?user=bob')).status).toBe(401);
    const up = await app.request('/uploads', { method: 'POST', body: JSON.stringify({ dataUrl: PNG }), headers: { 'content-type': 'application/json' } });
    expect(up.status).toBe(401);
  });

  it('answers /study/index for the token user only', async () => {
    const app = studyRoutes(dir);
    const auth = { authorization: `Bearer ${sign({ sub: 'alice', exp: now + 60 })}` };
    const own = await app.request('/study/index', { headers: auth });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ streak: 0, today: 0, totalCards: 0 });
    expect((await app.request('/study/index?user=bob', { headers: auth })).status).toBe(403);
  });

  it('accepts an authed upload', async () => {
    const app = studyRoutes(dir);
    const res = await app.request('/uploads', {
      method: 'POST',
      body: JSON.stringify({ dataUrl: PNG }),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${sign({ sub: 'alice', exp: now + 60 })}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('blocks disallowed origins when STUDY_ALLOWED_ORIGINS is set', async () => {
    process.env.STUDY_ALLOWED_ORIGINS = 'http://localhost:3000';
    const app = studyRoutes(dir);
    const auth = `Bearer ${sign({ sub: 'alice', exp: now + 60 })}`;
    expect((await app.request('/usage', { headers: { authorization: auth, origin: 'https://evil.example' } })).status).toBe(403);
    expect((await app.request('/usage', { headers: { authorization: auth, origin: 'http://localhost:3000' } })).status).toBe(200);
  });

  it('stays open in dev mode (no secret) and uses ?user=', async () => {
    delete process.env.STUDY_JWT_SECRET;
    const app = studyRoutes(dir);
    expect((await app.request('/usage')).status).toBe(200);
    expect((await app.request('/study/index?user=bob')).status).toBe(200);
  });
});

describe('GET /usage is per student (P3)', () => {
  const routerCall = (student: string | undefined, tokens: number, id: string) => {
    const f = makeTracedFetch(async () => new Response(JSON.stringify({ usage: { total_tokens: tokens } }), { headers: { 'content-type': 'application/json', 'x-request-id': id } }));
    return runWithContext({ studentId: student, calls: [] }, () => f('https://router/v1/chat/completions'));
  };
  let dir: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'));
    resetRouterTrace();
    await routerCall('alice', 100, 'req-alice-1');
    await routerCall('alice', 50, 'req-alice-2');
    await routerCall('bob', 7, 'req-bob-1');
    await routerCall(undefined, 1000, 'req-anon-1');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); delete process.env.STUDY_JWT_SECRET; resetRouterTrace(); });

  it("with study tokens, A's calls never appear in B's /usage", async () => {
    process.env.STUDY_JWT_SECRET = SECRET;
    const app = studyRoutes(dir);
    const get = async (sub: string, q = '') => (await app.request(`/usage${q}`, { headers: { authorization: `Bearer ${sign({ sub, exp: now + 60 })}` } })).json();
    const a = await get('alice');
    expect(a).toMatchObject({ calls: 2, tokens: 150, lastRequestIds: ['req-alice-1', 'req-alice-2'] });
    const b = await get('bob');
    expect(b).toMatchObject({ calls: 1, tokens: 7, lastRequestIds: ['req-bob-1'] });
    expect(JSON.stringify(b)).not.toContain('alice');
    expect(await get('carol')).toMatchObject({ calls: 0, tokens: 0, lastRequestIds: [] });
    // ?user= cannot widen it.
    expect(await get('bob', '?user=alice')).toMatchObject({ calls: 1, tokens: 7 });
  });

  it('open dev mode (no secret) keeps the process-wide numbers', async () => {
    const r = await (await studyRoutes(dir).request('/usage')).json();
    expect(r).toMatchObject({ calls: 4, tokens: 1157 });
  });
});
