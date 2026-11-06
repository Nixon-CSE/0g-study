#!/usr/bin/env node
// Check a deployment from outside, without spending anything: no 0G call, no key, no sign-in.
//
//   node scripts/smoke-deployed.mjs <app URL> <backend URL> <agent URL>
//
// Proves the three services are up and locked down: health, 401s, CORS, admin routes, /usage.
// It makes no model calls. Exits 1 if any check fails.
const [APP, BACKEND, AGENT] = process.argv.slice(2).map((u) => u?.replace(/\/$/, ''));
if (!AGENT) { console.error('usage: node scripts/smoke-deployed.mjs <app URL> <backend URL> <agent URL>'); process.exit(2); }

const EVIL = 'https://evil.example';

// Free hosts sleep when idle, and waking takes about a minute. Wake everything before the timed checks.
console.log('Warming up (a sleeping free service can take about a minute)…');
await Promise.all([`${AGENT}/health`, `${BACKEND}/health`, `${APP}/`].map((u) =>
  fetch(u, { signal: AbortSignal.timeout(150_000) }).then((r) => r.text()).catch(() => {})));
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  catch (e) { results.push(false); console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${e.message}`); }
}
const group = (name) => console.log(`\n\x1b[1m${name}\x1b[0m`);
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function req(url, init = {}, timeout = 30000) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { redirect: 'manual', ...init, signal: AbortSignal.timeout(timeout) });
      return { status: r.status, headers: r.headers, text: await r.text() };
    } catch (e) { if (i >= 1) throw new Error(`${url}: ${e?.cause?.code ?? e?.name ?? e}`); }
  }
}
const expect = async (base, path, want, init) => {
  const r = await req(`${base}${path}`, init);
  assert(want.includes(r.status), `${init?.method ?? 'GET'} ${path}: expected ${want.join(' or ')}, got ${r.status}`);
};
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const fakeJwt = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"x"}').toString('base64url')}.`;
const bearer = (t) => ({ headers: { authorization: `Bearer ${t}` } });

group('Up');
await check('app landing page: 200, says "0G Study"', async () => {
  const r = await req(`${APP}/`, {}, 90000);
  assert(r.status === 200, `status ${r.status}`);
  assert(/0G Study/i.test(r.text), 'no "0G Study" in the page');
});
await check('backend /health: 200, database connected', async () => {
  const r = await req(`${BACKEND}/health`);
  assert(r.status === 200, `status ${r.status}`);
  assert(JSON.parse(r.text).subsystems?.db === true, `db not connected: ${r.text.slice(0, 120)}`);
});
await check('agent /health: 200', () => expect(AGENT, '/health', [200]));

group('Backend is locked');
await check('protected routes: 401 without a token', async () => {
  for (const p of ['/v1/servers', '/v1/auth/me', '/v1/auth/study-token']) await expect(BACKEND, p, [401]);
});
await check('garbage and unsigned tokens: 401', async () => {
  for (const t of ['garbage', fakeJwt]) await expect(BACKEND, '/v1/servers', [401], bearer(t));
});

group('Agent is locked');
await check('/usage: 401 without a token (STUDY_JWT_SECRET is set)', () => expect(AGENT, '/usage', [401]));
await check('/usage, /uploads, /study/*: 401 with a forged token', async () => {
  await expect(AGENT, '/usage', [401], bearer(fakeJwt));
  await expect(AGENT, '/study/index', [401], bearer(fakeJwt));
  await expect(AGENT, '/uploads', [401], { ...json({ dataUrl: 'x' }), ...{ headers: { 'content-type': 'application/json', authorization: `Bearer ${fakeJwt}` } } });
});
await check('admin routes: 401 without the admin token', async () => {
  for (const p of ['/tenants', '/config', '/mcp/servers', '/skills']) await expect(AGENT, p, [401]);
  for (const p of ['/mcp/servers', '/tenants', '/skills/install', '/rag/kb/search', '/rag/kb/index']) await expect(AGENT, p, [401], json({}));
  await expect(AGENT, '/config', [401], { ...json({ name: 'x' }), method: 'PATCH' });
});
await check('admin routes: a wrong admin token is refused', () =>
  expect(AGENT, '/tenants', [401], { headers: { 'x-agent-admin-token': 'wrong' } }));
await check('GET /events: 401', async () => {
  const c = new AbortController();
  const r = await fetch(`${AGENT}/events`, { signal: c.signal });
  c.abort();
  assert(r.status === 401, `status ${r.status}`);
});

group('CORS');
const preflight = async (base, path, origin) => {
  const r = await req(`${base}${path}`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  return r.headers.get('access-control-allow-origin');
};
await check('backend grants the app, not a stranger', async () => {
  const app = await preflight(BACKEND, '/v1/servers', APP), evil = await preflight(BACKEND, '/v1/servers', EVIL);
  assert(app === APP, `app origin got ${app} (check CORS_ORIGINS)`);
  assert(evil !== EVIL && evil !== '*', `stranger got ${evil}`);
});
await check('agent grants the app, not a stranger', async () => {
  const app = await preflight(AGENT, '/usage', APP), evil = await preflight(AGENT, '/usage', EVIL);
  assert(app === APP, `app origin got ${app} (check STUDY_ALLOWED_ORIGINS)`);
  assert(evil !== EVIL && evil !== '*', `stranger got ${evil}`);
});
await check('a stranger\'s page is refused on the study routes, even with a token header', () =>
  expect(AGENT, '/usage', [401, 403], { headers: { origin: EVIL, authorization: `Bearer ${fakeJwt}` } }));

const failed = results.filter((ok) => !ok).length;
console.log(`\n${failed ? `\x1b[31m${failed} failed\x1b[0m` : '\x1b[32mall passed\x1b[0m'}, ${results.length} checks`);
process.exit(failed ? 1 : 0);
