#!/usr/bin/env node
// Live end-to-end tests against the RUNNING stack (./run-local.sh) — real HTTP, real 0G calls.
//
//   node scripts/e2e-live.mjs                 security + API contract + real 0G chat + real 0G vision
//   node scripts/e2e-live.mjs --offline       skip anything that spends 0G credits
//   E2E_PRIVY_TOKEN=... node scripts/e2e-live.mjs   also run the full Study Pod pipeline through the backend
//       (get the token in the browser console at localhost:3000: JSON.parse(localStorage.getItem('privy:token')))
//
// Zero dependencies (Node >= 20). Reads agent/.env and backend/.env for secrets; never prints them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFLINE = process.argv.includes('--offline');
const AGENT = process.env.AGENT_URL ?? 'http://localhost:7777';
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:8080';
const APP = process.env.APP_URL ?? 'http://localhost:3000';
const EVIL = 'https://evil.example';
const PHOTO = path.join(ROOT, 'scripts/fixtures/notes-sample.png');
const PHOTO2 = path.join(ROOT, 'scripts/fixtures/notes-physics.png'); // a different topic, for study memory (RAG)

function readEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* missing file */ }
  return out;
}
const agentEnv = readEnv('agent/.env');
const backendEnv = readEnv('backend/.env');
const JWT_SECRET = backendEnv.JWT_SECRET;
const ADMIN_TOKEN = agentEnv.AGENT_ADMIN_TOKEN;

// ── tiny test harness ────────────────────────────────────────────────────────
const results = [];
let section = '';
const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };
function group(name) { section = name; console.log(`\n${C.b(name)}`); }
async function test(name, fn, { skip } = {}) {
  if (skip) { results.push({ section, name, status: 'skip', why: skip }); console.log(`  ${C.y('○')} ${name} ${C.y(`(skipped: ${skip})`)}`); return; }
  const t = Date.now();
  try { await fn(); results.push({ section, name, status: 'pass' }); console.log(`  ${C.g('✓')} ${name} ${C.y(`${Date.now() - t}ms`)}`); }
  catch (e) { results.push({ section, name, status: 'fail', why: e.message }); console.log(`  ${C.r('✗')} ${name}\n      ${C.r(e.message)}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
const eq = (a, b, what) => assert(a === b, `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

async function req(base, p, { method = 'GET', headers = {}, body, timeout = 15000 } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeout) };
  if (body !== undefined) { init.body = typeof body === 'string' ? body : JSON.stringify(body); init.headers['content-type'] ??= 'application/json'; }
  const res = await fetch(`${base}${p}`, init);
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}

function hs256(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const studyToken = (sub = 'e2etester') => hs256({ sub, exp: nowS() + 600 }, JWT_SECRET);
const bearer = (t) => ({ authorization: `Bearer ${t}` });
const admin = () => (ADMIN_TOKEN ? { 'x-agent-admin-token': ADMIN_TOKEN } : {});
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MARKER_RE = /⟦0g:([^⟧]+)⟧\s*$/;

// The agent only honours `studentId` from the backend (admin token), so send it like the backend does.
async function chatAgent(body, timeoutMs = 120000) {
  const r = await req(AGENT, '/chat/message', { method: 'POST', body, headers: body.studentId ? admin() : {} });
  eq(r.status, 200, 'POST /chat/message');
  const res = await fetch(`${AGENT}/chat/stream/${r.json.streamId}`, { signal: AbortSignal.timeout(timeoutMs) });
  const decoder = new TextDecoder();
  let buf = '', out = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      if (ev.startsWith('event: done')) return out;
      const d = ev.split('\n').find((l) => l.startsWith('data: '));
      if (d) { try { out += JSON.parse(d.slice(6)).chunk ?? ''; } catch { /* keep-alive */ } }
    }
  }
  return out;
}

// ── 0. preconditions ─────────────────────────────────────────────────────────
group('0. Stack is up');
await test('agent /health', async () => { eq((await req(AGENT, '/health')).status, 200, 'status'); });
await test('backend /health', async () => { eq((await req(BACKEND, '/health')).status, 200, 'status'); });
await test('app serves the landing page', async () => {
  const r = await req(APP, '/', { timeout: 60000 });
  eq(r.status, 200, 'status');
  assert(/0G Study/i.test(r.text), 'landing page does not mention "0G Study"');
});
await test('secrets are configured (JWT_SECRET ≥ 32, shared with agent; admin token set)', async () => {
  assert(JWT_SECRET && JWT_SECRET.length >= 32, 'backend JWT_SECRET missing/short');
  eq(agentEnv.STUDY_JWT_SECRET, JWT_SECRET, 'agent STUDY_JWT_SECRET must equal backend JWT_SECRET');
  assert(ADMIN_TOKEN && ADMIN_TOKEN === backendEnv.AGENT_ADMIN_TOKEN, 'AGENT_ADMIN_TOKEN missing or differs between agent and backend');
  assert(!fs.readFileSync(path.join(ROOT, 'app/.env.local'), 'utf8').match(/NEXT_PUBLIC_[A-Z_]*=(sk-|mk-)/), 'a 0G key is exposed through a NEXT_PUBLIC_ variable');
});

// ── 1. agent: study auth ─────────────────────────────────────────────────────
group('1. Agent study endpoints — authentication (NFR1)');
await test('/usage without a token → 401 (DEPLOY.md smoke check)', async () => eq((await req(AGENT, '/usage')).status, 401, 'status'));
await test('token signed with the wrong secret → 401', async () => eq((await req(AGENT, '/usage', { headers: bearer(hs256({ sub: 'x', exp: nowS() + 60 }, 'z'.repeat(40))) })).status, 401, 'status'));
await test('expired token → 401', async () => eq((await req(AGENT, '/usage', { headers: bearer(hs256({ sub: 'x', exp: nowS() - 5 }, JWT_SECRET)) })).status, 401, 'status'));
await test('alg=none token → 401', async () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  eq((await req(AGENT, '/usage', { headers: bearer(`${enc({ alg: 'none' })}.${enc({ sub: 'x', exp: nowS() + 60 })}.`) })).status, 401, 'status');
});
await test('valid study token → 200 with usage counters', async () => {
  const r = await req(AGENT, '/usage', { headers: bearer(studyToken()) });
  eq(r.status, 200, 'status');
  assert(typeof r.json?.calls === 'number' && typeof r.json?.tokens === 'number', `bad body ${r.text}`);
});
await test('disallowed browser Origin is refused even with a valid token', async () => {
  eq((await req(AGENT, '/usage', { headers: { ...bearer(studyToken()), origin: EVIL } })).status, 403, 'status');
});
await test("a student cannot read another student's streak", async () => {
  const r = await req(AGENT, '/study/index?user=someoneelse', { headers: bearer(studyToken('e2etester')) });
  eq(r.status, 403, 'status');
  const own = await req(AGENT, '/study/index', { headers: bearer(studyToken('e2etester')) });
  eq(own.status, 200, 'own status');
  assert(['streak', 'today', 'totalCards'].every((k) => typeof own.json?.[k] === 'number'), `bad body ${own.text}`);
});

// ── 2. agent: admin surface ──────────────────────────────────────────────────
group('2. Agent admin surface — no remote code execution');
const rce = { id: 'e2e-pwn', command: 'sh', args: ['-c', 'echo pwned > /tmp/e2e-pwned'] };
await test('POST /mcp/servers without the admin token → 401', async () => eq((await req(AGENT, '/mcp/servers', { method: 'POST', body: rce })).status, 401, 'status'));
await test('…from a malicious web page (cross-origin) → refused', async () => {
  const s = (await req(AGENT, '/mcp/servers', { method: 'POST', body: rce, headers: { origin: EVIL } })).status;
  assert(s === 401 || s === 403, `expected 401/403, got ${s}`);
});
await test('…with a wrong token → 401', async () => eq((await req(AGENT, '/mcp/servers', { method: 'POST', body: rce, headers: { 'x-agent-admin-token': 'nope' } })).status, 401, 'status'));
await test('PATCH /config, POST /tenants, POST /skills/install, GET /events all refuse anonymous callers', async () => {
  for (const [m, p, b] of [['PATCH', '/config', { name: 'pwned' }], ['POST', '/tenants', { slug: 'x' }], ['POST', '/skills/install', { url: 'x' }], ['GET', '/tenants'], ['GET', '/config']]) {
    eq((await req(AGENT, p, { method: m, body: b })).status, 401, `${m} ${p}`);
  }
  const ev = await fetch(`${AGENT}/events`, { signal: AbortSignal.timeout(5000) });
  eq(ev.status, 401, 'GET /events'); await ev.body?.cancel();
});
await test('the payload never landed in mcp.json', async () => {
  const r = await req(AGENT, '/mcp/servers', { headers: admin() });
  eq(r.status, 200, 'admin GET status');
  assert(!r.json?.servers?.['e2e-pwn'], 'malicious MCP server was persisted!');
});
await test('knowledge-base RAG routes (/rag/kb/*) refuse anonymous callers', async () => {
  for (const p of ['/rag/kb/index', '/rag/kb/delete', '/rag/kb/search']) eq((await req(AGENT, p, { method: 'POST', body: { serverId: 'x' } })).status, 401, p);
});
await test('the admin token does work (backend/seed path)', async () => eq((await req(AGENT, '/config', { headers: admin() })).status, 200, 'status'));

// ── 3. agent: uploads ────────────────────────────────────────────────────────
group('3. Notes photo upload');
let uploadId = null;
await test('rejects SVG (script-capable), remote URLs and non-base64', async () => {
  for (const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://evil.example/a.png', 'data:image/png;base64,ab cd']) {
    eq((await req(AGENT, '/uploads', { method: 'POST', headers: bearer(studyToken()), body: { dataUrl } })).status, 400, dataUrl.slice(0, 30));
  }
});
await test('rejects > 8 MB with 413', async () => {
  const dataUrl = 'data:image/png;base64,' + 'A'.repeat(8_000_001);
  eq((await req(AGENT, '/uploads', { method: 'POST', headers: bearer(studyToken()), body: { dataUrl }, timeout: 30000 })).status, 413, 'status');
});
await test('accepts the sample notes photo and returns a server-generated UUID', async () => {
  const dataUrl = `data:image/png;base64,${fs.readFileSync(PHOTO).toString('base64')}`;
  const r = await req(AGENT, '/uploads', { method: 'POST', headers: bearer(studyToken()), body: { dataUrl } });
  eq(r.status, 200, `status (${r.text})`);
  assert(UUID_RE.test(r.json?.id ?? ''), `id is not a UUID: ${r.json?.id}`);
  uploadId = r.json.id;
});

// ── 4. backend ───────────────────────────────────────────────────────────────
group('4. Backend API — auth & CORS');
await test('protected routes → 401 without a token', async () => {
  for (const p of ['/v1/servers', '/v1/auth/me', '/v1/auth/study-token']) eq((await req(BACKEND, p)).status, 401, p);
});
await test('forged / garbage bearer tokens → 401', async () => {
  for (const t of ['garbage', hs256({ sub: 'x', exp: nowS() + 60 }, JWT_SECRET), 'mock-token:did:privy:x']) {
    eq((await req(BACKEND, '/v1/servers', { headers: bearer(t) })).status, 401, t.slice(0, 20));
  }
});
await test('CORS does not grant a malicious origin', async () => {
  const r = await fetch(`${BACKEND}/v1/servers`, { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'GET' } });
  const allowed = r.headers.get('access-control-allow-origin');
  assert(allowed !== EVIL && allowed !== '*', `backend allowed origin ${allowed}`);
});
await test('CORS does grant the app origin', async () => {
  const r = await fetch(`${BACKEND}/v1/servers`, { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'GET' } });
  eq(r.headers.get('access-control-allow-origin'), APP, 'allow-origin');
});
await test('public agent MCP listings never expose env values', async () => {
  const list = await req(BACKEND, '/v1/agents');
  if (list.status !== 200) return;
  for (const a of (list.json?.agents ?? []).slice(0, 10)) {
    const r = await req(BACKEND, `/v1/agents/${a.slug ?? a.id}/mcp/servers`);
    for (const s of Object.values(r.json?.servers ?? {})) {
      for (const v of Object.values(s.env ?? {})) eq(v, '***', `env value of ${a.slug}`);
    }
  }
});

// ── 5. real 0G inference ─────────────────────────────────────────────────────
group('5. Real 0G Private Computer calls (spends a few credits)');
const off = OFFLINE ? '--offline' : undefined;
await test('chat reply carries a 0G request-id proof marker', async () => {
  const reply = await chatAgent({ userId: `e2e-${Date.now()}`, text: 'Reply with exactly one word: PONG' });
  assert(/pong/i.test(reply), `unexpected reply: ${reply.slice(0, 200)}`);
  const m = reply.match(MARKER_RE);
  assert(m, `no ⟦0g:…⟧ marker at the end of the reply: ${JSON.stringify(reply.slice(-120))}`);
  assert(m[1].split(',').every((id) => /^[A-Za-z0-9-]{8,64}$/.test(id)), `bad request ids: ${m[1]}`);
}, { skip: off });
await test('/usage counted the call', async () => {
  const r = await req(AGENT, '/usage', { headers: bearer(studyToken()) });
  assert(r.json.calls >= 1 && r.json.lastRequestIds.length >= 1, `usage did not move: ${r.text}`);
}, { skip: off });

let tenants = [];
try { tenants = (await req(AGENT, '/tenants', { headers: admin() })).json?.tenants?.map((t) => t.slug) ?? []; } catch { /* agent down */ }
const podReady = ['study-note-reader', 'study-tutor', 'study-examiner'].every((s) => tenants.includes(s));
await test('Note Reader transcribes the photo with 0G vision (faithful, no invention)', async () => {
  assert(uploadId, 'upload step failed earlier');
  const reply = await chatAgent({ userId: `e2e-${Date.now()}`, studentId: 'e2etester', tenant: 'study-note-reader', text: `@study-note-reader [[upload:${uploadId}]]` }, 180000);
  const lower = reply.toLowerCase();
  const hits = ['photosynthesis', 'calvin', 'rubisco', 'thylakoid', 'nadph'].filter((w) => lower.includes(w));
  assert(hits.length >= 3, `vision did not read the notes (matched ${hits.join(',') || 'nothing'}). Reply: ${reply.slice(0, 300)}`);
  assert(!/couldn't read the notes/i.test(reply), `tool reported a failure: ${reply.slice(0, 300)}`);
  assert(MARKER_RE.test(reply), 'no 0G proof marker on the vision reply');
}, { skip: off ?? (podReady ? undefined : 'pod tenants not registered — run ./run-local.sh seed <you> first') });

// ── 6. full pipeline through the backend (needs a real Privy session) ───────
group('6. Study Pod pipeline via the backend (photo → Reader → Tutor → Examiner)');
const PRIVY = process.env.E2E_PRIVY_TOKEN?.replace(/^"|"$/g, '');
await test('signed-in user gets a study token the agent accepts', async () => {
  const r = await req(BACKEND, '/v1/auth/study-token', { headers: bearer(PRIVY) });
  eq(r.status, 200, 'status');
  eq((await req(AGENT, '/usage', { headers: bearer(r.json.token) })).status, 200, 'agent accepts backend token');
}, { skip: PRIVY ? undefined : 'set E2E_PRIVY_TOKEN' });
await test('three agent replies, each with a 0G proof badge, and flashcards logged', async () => {
  const st = (await req(BACKEND, '/v1/auth/study-token', { headers: bearer(PRIVY) })).json.token;
  const sub = JSON.parse(Buffer.from(st.split('.')[1], 'base64url').toString()).sub;
  const before = (await req(AGENT, '/study/index', { headers: bearer(st) })).json;
  const servers = (await req(BACKEND, '/v1/servers', { headers: bearer(PRIVY) })).json.servers;
  const study = servers.find((s) => s.slug === 'study');
  assert(study, 'no "study" server — run ./run-local.sh seed <you>');
  const chans = (await req(BACKEND, `/v1/servers/${study.id}/channels`, { headers: bearer(PRIVY) })).json.channels;
  const ch = chans.find((c) => c.name === 'study');
  assert(ch, 'no #study channel');
  const dataUrl = `data:image/png;base64,${fs.readFileSync(PHOTO).toString('base64')}`;
  const up = await req(AGENT, '/uploads', { method: 'POST', headers: bearer(st), body: { dataUrl } });
  eq(up.status, 200, 'upload');
  const t0 = new Date(Date.now() - 2000).toISOString();
  const sent = await req(BACKEND, `/v1/channels/${ch.id}/messages`, { method: 'POST', headers: bearer(PRIVY), body: { content: `@study-note-reader [[upload:${up.json.id}]]` }, timeout: 300000 });
  assert(sent.status < 300, `post failed ${sent.status} ${sent.text.slice(0, 200)}`);
  const rootId = sent.json?.message?.id ?? sent.json?.id;
  const deadline = Date.now() + 300000;
  let replies = [];
  while (Date.now() < deadline) {
    const msgs = (await req(BACKEND, `/v1/channels/${ch.id}/messages?limit=50`, { headers: bearer(PRIVY) })).json.messages;
    replies = msgs.filter((m) => m.authorType === 'agent' && m.createdAt >= t0 && (!rootId || m.cascadeRootId === rootId));
    if (replies.length >= 3 && replies.every((m) => MARKER_RE.test(m.content))) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  assert(replies.length >= 3, `expected ≥3 agent replies, got ${replies.length}`);
  for (const m of replies) assert(MARKER_RE.test(m.content), `agent reply without 0G proof: ${m.content.slice(0, 120)}`);
  const after = (await req(AGENT, '/study/index', { headers: bearer(st) })).json;
  assert(after.totalCards > before.totalCards, `no flashcards logged for ${sub} (before ${before.totalCards}, after ${after.totalCards})`);
  assert(after.streak >= 1, 'streak did not start');
}, { skip: PRIVY ? (OFFLINE ? '--offline' : undefined) : 'set E2E_PRIVY_TOKEN' });

// ── 7. study memory: RAG on 0G embeddings ───────────────────────────────────
group('7. Study memory — RAG on 0G embeddings (two photos, recall the first)');
const ragStudent = `e2erag${Date.now().toString(36)}`;
const NOTES_CITE_RE = /\[notes · \d{4}-\d{2}-\d{2} · #\d+\]/;
async function readPhotoAs(student, photo) {
  const dataUrl = `data:image/png;base64,${fs.readFileSync(photo).toString('base64')}`;
  const up = await req(AGENT, '/uploads', { method: 'POST', headers: bearer(studyToken(student)), body: { dataUrl } });
  eq(up.status, 200, 'upload');
  return chatAgent({ userId: `e2e-rag-${Date.now()}`, studentId: student, tenant: 'study-note-reader', text: `@study-note-reader [[upload:${up.json.id}]]` }, 180000);
}
const ragSkip = off ?? (podReady ? undefined : 'pod tenants not registered — run ./run-local.sh seed <you> first');
await test('two different notes photos are read and remembered for the same student', async () => {
  const bio = await readPhotoAs(ragStudent, PHOTO);
  assert(/photosynthesis|calvin|rubisco/i.test(bio), `biology notes not read: ${bio.slice(0, 200)}`);
  const phys = await readPhotoAs(ragStudent, PHOTO2);
  assert(/newton|inertia|momentum/i.test(phys), `physics notes not read: ${phys.slice(0, 200)}`);
  // read_notes = vision call + embeddings call → at least two 0G ids on the reply
  const ids = phys.match(MARKER_RE)?.[1].split(',') ?? [];
  assert(ids.length >= 2, `expected vision + embedding request ids on the reply, got ${ids.join(',') || 'none'}`);
}, { skip: ragSkip });
await test('GET /study/recall finds the FIRST photo for its owner (with a 0G request id), nothing for another student', async () => {
  const q = encodeURIComponent('Which enzyme fixes carbon dioxide in the Calvin cycle?');
  const r = await req(AGENT, `/study/recall?q=${q}`, { headers: bearer(studyToken(ragStudent)), timeout: 60000 });
  eq(r.status, 200, `status (${r.text.slice(0, 200)})`);
  assert(r.json.results.length > 0 && /rubisco/i.test(r.json.results[0].text), `top hit is not the RuBisCO passage: ${JSON.stringify(r.json.results[0] ?? null).slice(0, 200)}`);
  assert(/^notes · \d{4}-\d{2}-\d{2} · #\d+$/.test(r.json.results[0].citation), `bad citation ${r.json.results[0].citation}`);
  assert(UUID_RE.test(r.json.requestIds?.[0] ?? ''), 'no 0G embeddings request id');
  const other = await req(AGENT, `/study/recall?q=${q}`, { headers: bearer(studyToken(`${ragStudent}x`)), timeout: 60000 });
  eq(other.json.results.length, 0, "another student's recall");
  eq((await req(AGENT, `/study/recall?q=${q}&user=${ragStudent}`, { headers: bearer(studyToken(`${ragStudent}x`)) })).status, 403, 'cross-user ?user=');
}, { skip: ragSkip });
await test('the Tutor answers a question only the first photo can answer, citing it, with a 0G marker', async () => {
  const reply = await chatAgent({
    userId: `e2e-rag-${Date.now()}`, studentId: ragStudent, tenant: 'study-tutor',
    text: 'Quick check before today\'s physics: which enzyme from my earlier biology notes fixes CO2? Look it up in my past notes and cite them.',
  }, 180000);
  assert(/rubisco/i.test(reply), `tutor did not recall RuBisCO: ${reply.slice(0, 300)}`);
  assert(NOTES_CITE_RE.test(reply), `no [notes · <day> · #n] citation: ${reply.slice(0, 300)}`);
  assert(MARKER_RE.test(reply), 'no ⟦0g:…⟧ marker');
}, { skip: ragSkip });

// ── report ───────────────────────────────────────────────────────────────────
const n = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${C.b('Live E2E')}: ${C.g(`${n('pass')} passed`)}, ${n('fail') ? C.r(`${n('fail')} failed`) : '0 failed'}, ${C.y(`${n('skip')} skipped`)}`);
fs.mkdirSync(path.join(ROOT, '.logs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.logs/e2e-live.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(n('fail') ? 1 : 0);
