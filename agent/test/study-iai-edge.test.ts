/** P5-iAI step 4: connecting a student's own pc.0g.ai account, and what happens when it goes wrong. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { APICallError, tool } from 'ai';
import { MockLanguageModelV1 } from 'ai/test';
import { z } from 'zod';
import {
  cachedUsageHistory, fetchBalance, fetchUsageHistory, forgetUsageHistory, keyFormatError, loadUserKeys, parseBalance, ownCreditsOutLine, previewMatches, saveUserKeys, untilCreditReset, verifyUserKeys,
} from '../src/study/zerog-account.js';
import { studyRoutes } from '../src/api/routes/study.js';
import { AgentRuntime, failureLine } from '../src/runtime/agent.js';
import { currentContext, runWithContext } from '../src/runtime/request-context.js';
import { MemoryStore } from '../src/memory/store.js';
import { makeStudyTools } from '../src/tools/builtin/study.js';
import { saveUpload } from '../src/study/uploads.js';
import { resetRouterTrace } from '../src/providers/zerog-router.js';
import { LOG_OPTIONS, scrubKeys } from '../src/util/logger.js';

const SECRET = 'y'.repeat(40);
const KEYS = { apiKey: 'sk-alice000000aaaa', managementKey: 'mk-alice000000bbbb' };
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub: string) => {
  const h = enc({ alg: 'HS256' }), p = enc({ sub, exp: Math.floor(Date.now() / 1000) + 60 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const auth = (sub: string) => ({ authorization: `Bearer ${token(sub)}`, 'content-type': 'application/json' });
const BAL = { currency: 'usd' as const, available: 437504n, credit: 437504n, deposit: 0n, unsettled: 0n };
const okBalance = async () => ({ ok: true as const, balance: BAL, address: '0xabc' });
const listed = (over: object = {}) => async () => ({ ok: true as const, keys: [{ preview: 'sk-alice…', revoked: false, expiresAt: null, ...over }] });
const fail = (status: number) => async () => ({ ok: false as const, status, error: 'x' });

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iai-'));
  process.env.STUDY_JWT_SECRET = SECRET;
  process.env.ZEROG_USER_ACCOUNTS = 'on';
  process.env.ZEROG_API_KEY = 'sk-sharedshared00';
  resetRouterTrace();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ['STUDY_JWT_SECRET', 'ZEROG_USER_ACCOUNTS', 'ZEROG_API_KEY', 'STUDY_DAILY_CALL_CAP']) delete process.env[k];
});

describe('invalid or revoked keys are rejected and never stored', () => {
  const connect = (deps: object, body: object = KEYS) =>
    studyRoutes(dir, deps as any).request('/study/account', { method: 'POST', headers: auth('alice'), body: JSON.stringify(body) });
  const cases: [string, object, number, RegExp][] = [
    ['mk- wrong or revoked (401)', { balance: fail(401), listKeys: listed() }, 400, /wrong or has been revoked/],
    ['mk- without account:read (403)', { balance: fail(403), listKeys: listed() }, 400, /Read-only preset/],
    ['mk- without keys:read (403)', { balance: okBalance, listKeys: fail(403) }, 400, /Read-only preset/],
    ['0G unreachable', { balance: fail(502), listKeys: listed() }, 502, /couldn't reach 0G/],
    ['sk- from another account', { balance: okBalance, listKeys: listed({ preview: 'sk-other…' }) }, 400, /same pc\.0g\.ai account/],
    ['sk- revoked', { balance: okBalance, listKeys: listed({ revoked: true }) }, 400, /revoked or has expired/],
    ['sk- expired', { balance: okBalance, listKeys: listed({ expiresAt: '2020-01-01T00:00:00Z' }) }, 400, /revoked or has expired/],
  ];
  for (const [name, deps, status, msg] of cases) {
    it(name, async () => {
      const r = await connect(deps);
      expect(r.status).toBe(status);
      const body = await r.text();
      expect(JSON.parse(body).error).toMatch(msg);
      expect(body).not.toContain(KEYS.apiKey);
      expect(await loadUserKeys(dir, 'alice')).toBeNull();
    });
  }
  it('bad prefixes get plain words, and no 0G call is made', async () => {
    const balance = vi.fn(okBalance);
    const r = await connect({ balance, listKeys: listed() }, { apiKey: 'mk-swapped0000', managementKey: 'sk-swapped0000' });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/should start with sk-/);
    expect(balance).not.toHaveBeenCalled();
    expect(keyFormatError({ apiKey: 'sk-abcdefgh1', managementKey: 'nope' })).toMatch(/should start with mk-/);
    expect(keyFormatError({ apiKey: 'sk-a', managementKey: 'mk-abcdefgh1' })).toMatch(/cut off/);
    expect(keyFormatError(KEYS)).toBeNull();
  });
  it('good keys connect; a revoked twin does not hide the active key', async () => {
    const keys = async () => ({ ok: true as const, keys: [{ preview: 'sk-alice…', revoked: true, expiresAt: null }, { preview: 'sk-alice…', revoked: false, expiresAt: '2999-01-01T00:00:00Z' }] });
    expect((await verifyUserKeys(KEYS, { balance: okBalance, listKeys: keys }))).toEqual({ ok: true, balance: BAL, address: '0xabc' });
    expect((await connect({ balance: okBalance, listKeys: keys })).status).toBe(200);
    expect(await loadUserKeys(dir, 'alice')).toEqual(KEYS);
  });
  it('previews match on what they show', () => {
    expect(previewMatches('sk-abcde…', 'sk-abcdefghij')).toBe(true);
    expect(previewMatches('sk-abcde...hij', 'sk-abcdefghij')).toBe(true);
    expect(previewMatches('sk-abcde…xyz', 'sk-abcdefghij')).toBe(false);
    expect(previewMatches('sk-zzzzz…', 'sk-abcdefghij')).toBe(false);
    expect(previewMatches('', 'sk-abcdefghij')).toBe(false);
    expect(previewMatches('sk…', 'sk-abcdefghij')).toBe(false);
  });
});

describe('a failed balance read never blocks studying', () => {
  it('shows no number, stays connected', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    const r = await studyRoutes(dir, { balance: fail(503) }).request('/study/account', { headers: auth('alice') });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: true, connected: true, balance: null, error: 'x' });
  });
});

describe('parseBalance (shapes from the real account, 2026-11-06)', () => {
  const USD = { address: '0xabc', currency: 'usd', deposit_balance: '0', credit_balance: '437504', pending_charge: '0', total_balance: '437504', balance: '437504', unsettled_charge: '0' };
  it('usd: integer micro-USD', () => {
    expect(parseBalance(USD)).toEqual({ currency: 'usd', available: 437504n, credit: 437504n, deposit: 0n, unsettled: 0n });
  });
  it('available drops as soon as a charge is unsettled, before total_balance moves', () => {
    expect(parseBalance({ ...USD, unsettled_charge: '8' })!.available).toBe(437496n);
    expect(parseBalance({ ...USD, total_balance: '437496', credit_balance: '437496' })!.available).toBe(437496n);
    expect(parseBalance({ ...USD, total_balance: '5', unsettled_charge: '8' })!.available).toBe(0n);
  });
  it('0g: neuron, exact beyond 2^53; currency may be absent', () => {
    const big = '1234567890123456789012';
    expect(parseBalance({ currency: '0g', total_balance: big, deposit_balance: big })).toEqual({ currency: '0g', available: BigInt(big), credit: 0n, deposit: BigInt(big), unsettled: 0n });
    expect(parseBalance({ total_balance: '1500000000000000000' })!.currency).toBe('0g');
  });
  it('missing or invalid fields give null, never a guess', () => {
    for (const bad of [{}, null, { currency: 'usd' }, { total_balance: 5 }, { total_balance: '-1' }, { total_balance: '1.5' }, { total_balance: 'abc' },
      { ...USD, currency: 'eur' }, { ...USD, credit_balance: 'x' }, { ...USD, unsettled_charge: -1 }]) expect(parseBalance(bad), JSON.stringify(bad)).toBeNull();
  });
  it('an unparseable balance still connects (the key is fine) and shows no number', async () => {
    const f = (async () => new Response(JSON.stringify({ total_balance: 'abc', address: '0xabc' }))) as any;
    expect(await fetchBalance('mk-abc12345678', f)).toEqual({ ok: true, balance: null, address: '0xabc' });
  });
});

describe('billing proof: GET /study/account/billing', () => {
  const row = (id: string, cost: number) => ({ requestId: id, cost: String(cost), creditUsed: String(cost), depositUsed: '0', model: 'gemini-2.5-flash', at: '2026-11-06T15:31:00Z' });
  const historyOf = (...ids: string[]) => vi.fn(async () => ({ ok: true as const, currency: 'usd', calls: ids.map((id, i) => row(id, 1034 + i)) }));
  const get = (app: any, q: string, sub = 'alice') => app.request(`/study/account/billing?${q}`, { headers: auth(sub) });
  beforeEach(async () => { forgetUsageHistory(); await saveUserKeys(dir, 'alice', KEYS); });

  it('matches the reply\'s ids against the student\'s own history, with their own mk- key', async () => {
    const history = historyOf('id-1', 'id-2', 'someone-else-call');
    const r = await (await get(studyRoutes(dir, { history }), 'ids=id-1,id-2,not-yet')).json();
    expect(history).toHaveBeenCalledWith(KEYS.managementKey);
    expect(r.currency).toBe('usd');
    expect(Object.keys(r.items)).toEqual(['id-1', 'id-2']);
    expect(r.items['id-1']).toMatchObject({ cost: '1034', creditUsed: '1034', depositUsed: '0', model: 'gemini-2.5-flash' });
    expect(JSON.stringify(r)).not.toContain(KEYS.managementKey);
  });
  it('a student without keys gets nothing, and no history is read', async () => {
    const history = historyOf('id-1');
    expect(await (await get(studyRoutes(dir, { history }), 'ids=id-1', 'bob')).json()).toEqual({ connected: false, items: {} });
    expect(history).not.toHaveBeenCalled();
  });
  it("never reads another student's history: ?user= is refused, caches are per student", async () => {
    const aliceHist = historyOf('id-1');
    expect((await get(studyRoutes(dir, { history: aliceHist }), 'ids=id-1&user=alice', 'bob')).status).toBe(403);
    await get(studyRoutes(dir, { history: aliceHist }), 'ids=id-1');
    await saveUserKeys(dir, 'bob', { apiKey: 'sk-bobbob00000aaaa', managementKey: 'mk-bobbob00000bbbb' });
    const bobHist = historyOf('id-9');
    const r = await (await get(studyRoutes(dir, { history: bobHist }), 'ids=id-1', 'bob')).json();
    expect(bobHist).toHaveBeenCalledWith('mk-bobbob00000bbbb');
    expect(r.items).toEqual({});
  });
  it('caches briefly, re-reads after; a failure is not cached; disconnect clears it', async () => {
    const read = historyOf('id-1');
    const t0 = 1_000_000;
    await cachedUsageHistory('alice', 'mk', read, t0);
    await cachedUsageHistory('alice', 'mk', read, t0 + 4_000);
    expect(read).toHaveBeenCalledTimes(1);
    await cachedUsageHistory('alice', 'mk', read, t0 + 6_000);
    expect(read).toHaveBeenCalledTimes(2);
    forgetUsageHistory();
    const down = vi.fn(async () => ({ ok: false as const, status: 502, error: 'x' }));
    await cachedUsageHistory('alice', 'mk', down, t0);
    await cachedUsageHistory('alice', 'mk', down, t0 + 1);
    expect(down).toHaveBeenCalledTimes(2);
  });
  it('history down: connected, nothing matched; bad requests are refused', async () => {
    const r = await (await get(studyRoutes(dir, { history: async () => ({ ok: false as const, status: 502, error: 'x' }) }), 'ids=id-1')).json();
    expect(r).toEqual({ connected: true, items: {}, error: 'x' });
    expect((await get(studyRoutes(dir), 'ids=')).status).toBe(400);
    expect((await get(studyRoutes(dir), 'ids=%3Cscript%3E')).status).toBe(400);
  });
  it('fetchUsageHistory maps the router fields', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ currency: 'usd', data: [{ request_id: 'r1', model_id: 'm', cost: 8, credit_used: '8', deposit_used: 0, created_at: 't' }, { cost: 1 }] })); }) as any;
    expect(await fetchUsageHistory('mk-x', 50, f)).toEqual({ ok: true, currency: 'usd', calls: [{ requestId: 'r1', cost: '8', creditUsed: '8', depositUsed: '0', model: 'm', at: 't' }] });
    expect(url).toMatch(/\/account\/usage\/history\?limit=50$/);
  });
});

describe('disconnect and isolation', () => {
  it('disconnect deletes the keys file', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    const file = path.join(dir, 'study', 'alice', 'zerog-keys.enc');
    expect(fs.existsSync(file)).toBe(true);
    const r = await studyRoutes(dir).request('/study/account', { method: 'DELETE', headers: auth('alice') });
    expect(await r.json()).toEqual({ connected: false });
    expect(fs.existsSync(file)).toBe(false);
  });
  it("one student's keys are never visible to, or deleted by, another", async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    const app = studyRoutes(dir, { balance: okBalance });
    expect(await (await app.request('/study/account', { headers: auth('bob') })).json()).toEqual({ enabled: true, connected: false });
    await app.request('/study/account?user=alice', { method: 'DELETE', headers: auth('bob') });
    expect(await loadUserKeys(dir, 'alice')).toEqual(KEYS);
  });
});

// ── runtime turns ────────────────────────────────────────────────────────────
const usage = { promptTokens: 1, completionTokens: 1 };
const raw = { rawPrompt: null, rawSettings: {} };
function runtime(doGenerate: any, tools: any = {}) {
  const store = new MemoryStore(path.join(dir, `m-${Math.random()}.json`), 8);
  const cfg: any = {
    name: 'T', id: 't', llm: { baseUrl: 'x', model: 'm', apiKeyEnv: 'X', temperature: 0.7, maxTokens: 100 },
    channels: { telegram: { enabled: false, tokenEnv: 'X', dmPolicy: 'open', allowFrom: [], groups: {} }, web: { enabled: true, path: '/chat' } },
    mcp: { configFile: 'mcp.json' }, evolution: { mode: 'off', intervalHours: 24, registries: [], interests: [] },
    memory: { maxSessions: 100, compactAfterTokens: 8000, vectorStorePath: 'x' }, tools: { builtin: {} }, logging: { level: 'info', logDir: '.' },
  };
  const rt = new AgentRuntime({
    loaded: { dir, config: cfg, soul: 's', agents: 'r', mcp: { servers: {} } } as any,
    model: new MockLanguageModelV1({ doGenerate }), embedModel: null, store, getSkills: () => [], getTools: () => tools,
  });
  return async (studentId: string) => {
    let out = '';
    await rt.handle({ channel: 'web', chatId: `c-${studentId}`, userId: 'u', studentId, text: 'hi', reply: async (t: string) => { out = t; } } as any);
    return out;
  };
}
const status = (statusCode: number) => new APICallError({ message: 'no', url: 'u', requestBodyValues: {}, statusCode, isRetryable: false });

describe('402 from the student\'s own key', () => {
  it('one honest line with the reset time and the free-tier option; no second attempt', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    const gen = vi.fn(async () => { throw status(402); });
    const out = await runtime(gen)('alice');
    expect(gen).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/Your own 0G credits have run out/);
    expect(out).toMatch(/00:00 UTC, in \d+h \d+m/);
    expect(out).toMatch(/disconnect/);
    expect(out).toMatch(/free tier/);
  });
  it('the shared key keeps its own message', async () => {
    const out = await runtime(async () => { throw status(402); })('bob');
    expect(out).toMatch(/Top it up at pc\.0g\.ai/);
    expect(out).not.toMatch(/Your own/);
  });
  it('a revoked key says so to the student, not "tell the app owner"', () => {
    expect(failureLine(status(401), { ownKey: true })).toMatch(/your connected API key/);
    expect(failureLine(status(401))).toMatch(/app owner/);
  });
  it('the vision call in read_notes: same line, on the student\'s key, never the shared key', async () => {
    const auths: (string | null)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => {
      auths.push(new Headers(init.headers).get('authorization'));
      return new Response('{"error":{"code":"insufficient_balance"}}', { status: 402, headers: { 'content-type': 'application/json' } });
    }));
    const up: any = await saveUpload(dir, 'data:image/png;base64,QklPTE9HWQ==');
    const r: any = await runWithContext({ studentId: 'alice', calls: [], zerogApiKey: KEYS.apiKey }, () =>
      (makeStudyTools(dir).read_notes as any).execute({ uploadId: up.id }, { toolCallId: 't', messages: [] }));
    expect(r).toMatchObject({ ok: false, status: 402 });
    expect(r.error).toMatch(/Your own 0G credits have run out/);
    expect(auths).toEqual([`Bearer ${KEYS.apiKey}`]);
  });
  it('counts down to 00:00 UTC', () => {
    expect(untilCreditReset(new Date('2026-11-06T20:45:30Z'))).toBe('3h 15m');
    expect(untilCreditReset(new Date('2026-11-06T23:59:59Z'))).toBe('0h 1m');
    expect(ownCreditsOutLine(new Date('2026-11-06T21:00:00Z'))).toContain('in 3h 0m');
  });
});

describe('shared daily cap and per-turn keys', () => {
  const reply = async () => ({ text: 'ok', finishReason: 'stop', usage, rawCall: raw });
  it('a connected student bypasses the shared cap; others hit it', async () => {
    process.env.STUDY_DAILY_CALL_CAP = '0';
    await saveUserKeys(dir, 'alice', KEYS);
    const run = runtime(reply);
    expect(await run('alice')).toBe('ok');
    expect(await run('bob')).toMatch(/today's limit/);
  });
  it('each turn carries only its own student\'s key', async () => {
    await saveUserKeys(dir, 'alice', KEYS);
    const seen: Record<string, string | undefined> = {};
    const probe = tool({ description: 'p', parameters: z.object({}), execute: async () => { const c = currentContext()!; seen[c.studentId!] = c.zerogApiKey; return {}; } });
    let n = 0;
    const gen = async () => (++n % 2 === 1
      ? { toolCalls: [{ toolCallType: 'function', toolCallId: `p${n}`, toolName: 'probe', args: '{}' }], finishReason: 'tool-calls', usage, rawCall: raw }
      : { text: 'ok', finishReason: 'stop', usage, rawCall: raw });
    const run = runtime(gen, { probe });
    await run('alice'); await run('bob');
    expect(seen).toEqual({ alice: KEYS.apiKey, bob: undefined });
  });
});

describe('keys never reach the logs', () => {
  it('masks keys in messages, nested fields, arrays and errors', () => {
    let out = '';
    const sink = new Writable({ write(c, _e, cb) { out += c; cb(); } });
    const l = pino({ ...LOG_OPTIONS, level: 'info' }, sink);
    l.info('connect sk-alice000000aaaa please');
    l.info({ deep: { list: ['mk-alice000000bbbb'], note: 'Bearer sk-alice000000aaaa' } }, 'x');
    l.warn({ err: new Error('bad key mk-alice000000bbbb') }, 'failed');
    l.error(new Error('bad key sk-alice000000aaaa'));
    l.info({ apiKey: KEYS.apiKey, managementKey: KEYS.managementKey, zerogApiKey: KEYS.apiKey }, 'named');
    expect(out).not.toContain('alice000000');
    expect(out).toContain('sk-[redacted]');
    expect(out).toContain('mk-[redacted]');
    expect(out).toContain('"type":"Error"');
  });
  it('leaves ordinary text alone', () => {
    expect(scrubKeys({ a: 'task-force risk-free desk-lamp', n: 3, b: null })).toEqual({ a: 'task-force risk-free desk-lamp', n: 3, b: null });
  });
  it('no key shape in any NEXT_PUBLIC variable of the app example env', () => {
    const env = fs.readFileSync(path.resolve(__dirname, '../../app/.env.local.example'), 'utf8');
    expect(env).not.toMatch(/NEXT_PUBLIC_[A-Z_]*=(sk|mk)-/);
  });
});
