/**
 * Study Pod hardening: auth edge cases, upload validation and quota, streak calendar edges,
 * flashcard durability under concurrency, and the read_notes → 0G vision contract
 * (including request-id tracing, which is what the UI's "0G · …" proof badge is built from).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyHs256, resetUploadCounts } from '../src/study/auth.js';
import { computeStreak, logStudySet, studyStats } from '../src/study/store.js';
import { saveUpload, readUpload, checkUpload, MAX_UPLOAD_CHARS } from '../src/study/uploads.js';
import { studyRoutes } from '../src/api/routes/study.js';
import { makeStudyTools } from '../src/tools/builtin/study.js';
import { runWithContext, type RequestContext } from '../src/runtime/request-context.js';
import { formatRequestIdMarker } from '../src/runtime/agent.js';

const SECRET = 's'.repeat(40);
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(payload: object, header: object = { alg: 'HS256', typ: 'JWT' }, secret = SECRET) {
  const h = enc(header), p = enc(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const cards = (n: number, tag = 'q') => Array.from({ length: n }, (_, i) => ({ q: `${tag}${i}`, a: `a${i}` }));

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-hard-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllGlobals(); });

describe('verifyHs256 — attacker-shaped tokens', () => {
  it('rejects a payload swapped under a valid signature (claiming another user)', () => {
    const [h, , s] = sign({ sub: 'alice', exp: now + 60 }).split('.');
    expect(verifyHs256(`${h}.${enc({ sub: 'mallory', exp: now + 60 })}.${s}`, SECRET)).toBeNull();
  });
  it('rejects algorithm confusion (HS512 / RS256 / none / missing alg)', () => {
    for (const alg of ['HS512', 'RS256', 'none', 'NONE', undefined]) {
      expect(verifyHs256(sign({ sub: 'alice', exp: now + 60 }, { alg }), SECRET), String(alg)).toBeNull();
    }
  });
  it('rejects not-yet-valid tokens and honours exp at the boundary', () => {
    expect(verifyHs256(sign({ sub: 'a', nbf: now + 120, exp: now + 600 }), SECRET)).toBeNull();
    expect(verifyHs256(sign({ sub: 'a', exp: now }), SECRET, now)).toBe('a');
    expect(verifyHs256(sign({ sub: 'a', exp: now - 1 }), SECRET, now)).toBeNull();
  });
  it('rejects subs that are not safe path ids', () => {
    for (const sub of [123, '', 'a'.repeat(65), 'a/b', 'a.b', '..', null, { $ne: 1 }]) {
      expect(verifyHs256(sign({ sub, exp: now + 60 }), SECRET), JSON.stringify(sub)).toBeNull();
    }
  });
  it('rejects a truncated or empty signature and junk segments without throwing', () => {
    const t = sign({ sub: 'a', exp: now + 60 });
    expect(verifyHs256(t.slice(0, -5), SECRET)).toBeNull();
    expect(verifyHs256(t.split('.').slice(0, 2).join('.') + '.', SECRET)).toBeNull();
    expect(verifyHs256('...', SECRET)).toBeNull();
    expect(verifyHs256('%%%.%%%.%%%', SECRET)).toBeNull();
  });
});

describe('upload validation', () => {
  it('only accepts png/jpeg/webp base64 data URLs', () => {
    expect(checkUpload(PNG)).toBeNull();
    expect(checkUpload('data:image/jpeg;base64,/9j/4AAQ')).toBeNull();
    expect(checkUpload('data:image/webp;base64,UklGRg==')).toBeNull();
    for (const bad of [
      'data:image/svg+xml;base64,PHN2Zz4=',          // SVG can carry script
      'data:image/png,rawbytes',                        // not base64
      'data:image/png;base64,abc def',                  // whitespace smuggling
      'data:image/png;base64,abc\n<script>',            // newline smuggling
      ' data:image/png;base64,AAAA',                    // leading space
      'DATA:IMAGE/PNG;BASE64,AAAA',
      'https://evil.example/x.png',                     // SSRF-style remote URL
      'file:///etc/passwd',
    ]) expect(checkUpload(bad), bad).not.toBeNull();
  });
  it('enforces the size limit exactly at the boundary', () => {
    const prefix = 'data:image/png;base64,';
    expect(checkUpload(prefix + 'A'.repeat(MAX_UPLOAD_CHARS - prefix.length))).toBeNull();
    expect(checkUpload(prefix + 'A'.repeat(MAX_UPLOAD_CHARS - prefix.length + 1))).toMatchObject({ status: 413 });
  });
  it('generates unique server-side ids and never trusts a client filename', async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) { const r = await saveUpload(dir, PNG); if (r.ok) ids.add(r.id); }
    expect(ids.size).toBe(25);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('readUpload refuses every traversal / injection shape', async () => {
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'nope');
    for (const id of ['../secret', '..%2fsecret', 'ABCDEF12-0000', 'a'.repeat(65), '', 'deadbeef/../../x', 'deadbeef\0']) {
      expect(await readUpload(dir, id), id).toBeNull();
    }
  });
});

describe('POST /uploads quota', () => {
  beforeEach(() => { resetUploadCounts(); process.env.STUDY_DAILY_UPLOAD_CAP = '1'; delete process.env.STUDY_JWT_SECRET; delete process.env.STUDY_ALLOWED_ORIGINS; });
  afterEach(() => { delete process.env.STUDY_DAILY_UPLOAD_CAP; });
  const post = (app: ReturnType<typeof studyRoutes>, body: unknown) =>
    app.request('/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('rejected uploads do not burn the daily quota; the cap then applies', async () => {
    const app = studyRoutes(dir);
    expect((await post(app, { dataUrl: 'data:image/gif;base64,AAAA' })).status).toBe(400);
    expect((await post(app, { dataUrl: 42 })).status).toBe(400);
    expect((await post(app, '{not json')).status).toBe(400);
    const ok = await post(app, { dataUrl: PNG });
    expect(ok.status).toBe(200);
    expect((await ok.json()).id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await post(app, { dataUrl: PNG })).status).toBe(429);
  });
});

describe('streak — calendar edges (UTC)', () => {
  const days = (...ds: string[]) => Object.fromEntries(ds.map((d) => [d, 1]));
  it('crosses month, year and leap-day boundaries', () => {
    expect(computeStreak(days('2026-10-30', '2026-10-31', '2026-11-01'), new Date('2026-11-01T08:00:00Z'))).toBe(3);
    expect(computeStreak(days('2026-12-31', '2027-01-01'), new Date('2027-01-01T08:00:00Z'))).toBe(2);
    expect(computeStreak(days('2028-02-28', '2028-02-29', '2028-03-01'), new Date('2028-03-01T08:00:00Z'))).toBe(3);
    expect(computeStreak(days('2027-02-28', '2027-03-01'), new Date('2027-03-01T08:00:00Z'))).toBe(2); // no Feb 29
  });
  it('uses UTC days, one second either side of midnight', () => {
    const d = days('2026-11-05');
    expect(computeStreak(d, new Date('2026-11-05T23:59:59Z'))).toBe(1);
    expect(computeStreak(d, new Date('2026-11-06T00:00:01Z'))).toBe(1);   // today not studied yet
    expect(computeStreak(d, new Date('2026-11-07T00:00:01Z'))).toBe(0);   // a full day missed
  });
  it('ignores days with zero cards and handles long streaks quickly', () => {
    expect(computeStreak({ '2026-11-04': 1, '2026-11-05': 0, '2026-11-06': 1 }, new Date('2026-11-06T12:00:00Z'))).toBe(1);
    const long: Record<string, number> = {};
    const end = Date.UTC(2026, 10, 6);
    for (let i = 0; i < 1000; i++) long[new Date(end - i * 86400000).toISOString().slice(0, 10)] = 2;
    const t = performance.now();
    expect(computeStreak(long, new Date('2026-11-06T12:00:00Z'))).toBe(1000);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe('flashcard log durability', () => {
  it('loses no flashcards under 40 concurrent writes (same user, same day)', async () => {
    const when = new Date('2026-11-06T10:00:00Z');
    await Promise.all(Array.from({ length: 40 }, (_, i) => logStudySet(dir, 'dana', { topic: `t${i}`, cards: cards(3, `c${i}-`) }, when)));
    const stats = await studyStats(dir, 'dana', when);
    expect(stats.today).toBe(120);
    expect(stats.totalCards).toBe(120);
    const sets = JSON.parse(fs.readFileSync(path.join(dir, 'study', 'dana', '2026-11-06.json'), 'utf8'));
    expect(new Set(sets.map((s: any) => s.topic)).size).toBe(40);
    expect(fs.readdirSync(path.join(dir, 'study', 'dana')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('recovers from a corrupt or non-array day file instead of crashing', async () => {
    const userDir = path.join(dir, 'study', 'eve');
    fs.mkdirSync(userDir, { recursive: true });
    const when = new Date('2026-11-06T10:00:00Z');
    fs.writeFileSync(path.join(userDir, '2026-11-06.json'), '{"truncated": ');
    await logStudySet(dir, 'eve', { topic: 't', cards: cards(2) }, when);
    expect((await studyStats(dir, 'eve', when)).today).toBe(2);
    fs.writeFileSync(path.join(userDir, '2026-11-06.json'), '{"not":"an array"}');
    await logStudySet(dir, 'eve', { topic: 't', cards: cards(1) }, when);
    expect((await studyStats(dir, 'eve', when)).today).toBe(1);
  });
  it('stats ignore stray files and keep users isolated', async () => {
    const when = new Date('2026-11-06T10:00:00Z');
    await logStudySet(dir, 'frank', { topic: 't', cards: cards(4) }, when);
    fs.writeFileSync(path.join(dir, 'study', 'frank', 'notes.json'), '[]');
    fs.writeFileSync(path.join(dir, 'study', 'frank', '2026-11-05.json.bak'), '[{"cards":[1,2,3]}]');
    expect(await studyStats(dir, 'frank', when)).toEqual({ streak: 1, today: 4, totalCards: 4 });
    expect(await studyStats(dir, 'grace', when)).toEqual({ streak: 0, today: 0, totalCards: 0 });
  });
});

describe('study_log tool schema', () => {
  it('bounds what the model can write', () => {
    const { study_log } = makeStudyTools(dir);
    const schema = (study_log as any).parameters;
    expect(schema.safeParse({ topic: 't', cards: cards(1) }).success).toBe(true);
    expect(schema.safeParse({ topic: 't', cards: cards(20) }).success).toBe(true);
    expect(schema.safeParse({ topic: 't', cards: [] }).success).toBe(false);
    expect(schema.safeParse({ topic: 't', cards: cards(21) }).success).toBe(false);
    expect(schema.safeParse({ topic: 'x'.repeat(121), cards: cards(1) }).success).toBe(false);
    expect(schema.safeParse({ topic: 't', cards: [{ q: 'only a question' }] }).success).toBe(false);
  });
});

describe('read_notes → 0G vision', () => {
  const REQ_ID = '27634878-a676-4163-a3f0-b8b064ffddc8';
  beforeEach(() => { process.env.ZEROG_API_KEY = 'sk-shared-key'; process.env.ZEROG_VISION_MODEL = 'vision-test-model'; });
  afterEach(() => { delete process.env.ZEROG_API_KEY; delete process.env.ZEROG_VISION_MODEL; });

  async function uploaded() { const r = await saveUpload(dir, PNG); if (!r.ok) throw new Error('upload'); return r.id; }
  const exec = (t: any, args: object) => t.execute(args, { toolCallId: 'c1', messages: [] });

  it('sends the stored image, the configured model and the key; returns the notes; traces the request id', async () => {
    const id = await uploaded();
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      if (url.endsWith('/embeddings')) return new Response('{"error":"unavailable"}', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '# Photosynthesis\n- light → sugar' } }], usage: { total_tokens: 321 } }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': REQ_ID } });
    }));
    const ctx: RequestContext = { studentId: 'hana', calls: [] };
    const r: any = await runWithContext(ctx, () => exec(makeStudyTools(dir).read_notes, { uploadId: id }));
    // The stub fails the follow-up study-memory embeddings call, so indexing fails
    // gracefully (remembered: false) and read_notes still succeeds — see rag-integration.test.ts.
    expect(r).toEqual({ ok: true, notes: '# Photosynthesis\n- light → sugar', remembered: false });
    expect(seen.filter((s) => s.url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(seen[0].url).toMatch(/\/chat\/completions$/);
    const body = JSON.parse(String(seen[0].init.body));
    expect(body.model).toBe('vision-test-model');
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: PNG } });
    expect(new Headers(seen[0].init.headers).get('authorization')).toBe('Bearer sk-shared-key');
    expect(ctx.calls.map((c: any) => c.requestId)).toContain(REQ_ID);
    expect(formatRequestIdMarker(ctx.calls.map((c: any) => c.requestId))).toBe(`\n\n⟦0g:${REQ_ID}⟧`);
  });

  it("bills a connected student's own 0G key instead of the shared one", async () => {
    const id = await uploaded();
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await runWithContext({ studentId: 'ivy', calls: [], zerogApiKey: 'sk-ivy-own' }, () => exec(makeStudyTools(dir).read_notes, { uploadId: id }));
    const auth = new Headers((f.mock.calls[0] as any)[1].headers).get('authorization');
    expect(auth).toBe('Bearer sk-ivy-own');
  });

  it('fails honestly (no guessing) on HTTP errors, empty output and network errors — and never leaks the key', async () => {
    const id = await uploaded();
    const tools = makeStudyTools(dir);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"channel unavailable"}', { status: 500 })));
    let r: any = await exec(tools.read_notes, { uploadId: id });
    expect(r).toMatchObject({ ok: false, status: 500 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 })));
    r = await exec(tools.read_notes, { uploadId: id });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`connect ECONNREFUSED ${'x'.repeat(500)}`); }));
    r = await exec(tools.read_notes, { uploadId: id });
    expect(r.ok).toBe(false);
    expect(r.error.length).toBeLessThan(200);
    for (const out of [r]) expect(JSON.stringify(out)).not.toContain('sk-shared-key');
  });

  it('refuses without a key and validates uploadId before any network call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    delete process.env.ZEROG_API_KEY;
    const r: any = await exec(makeStudyTools(dir).read_notes, { uploadId: await uploaded() });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/ZEROG_API_KEY/) });
    expect((makeStudyTools(dir).read_notes as any).parameters.safeParse({ uploadId: '../../etc/passwd' }).success).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('0G proof marker', () => {
  it('drops missing ids and emits nothing when there are none', () => {
    expect(formatRequestIdMarker([])).toBe('');
    expect(formatRequestIdMarker([null, null])).toBe('');
    expect(formatRequestIdMarker(['a', null, 'b'])).toBe('\n\n⟦0g:a,b⟧');
  });
});
