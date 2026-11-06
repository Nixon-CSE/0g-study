#!/usr/bin/env node
// Step 0 of the iAI integration: measure, on a REAL pc.0g.ai account, which balance field drops when
// that account's own sk- key makes a call. No mocks. Keys are read from env and never printed.
//
//   ZG_MK=mk-... ZG_SK=sk-... node agent/scripts/probe-account.mjs
//
// Prints: the full /v1/account/balance response (addresses shortened), usage/stats and the newest
// usage/history row, then makes ONE tiny chat call with the sk- key and polls every 3 s for 45 s,
// reporting every numeric field that changed.
const base = (process.env.ZEROG_BASE_URL || 'https://router-api.0g.ai/v1').replace(/\/$/, '');
const MK = process.env.ZG_MK, SK = process.env.ZG_SK;
if (!/^mk-/.test(MK || '') || !/^sk-/.test(SK || '')) {
  console.error('set ZG_MK=mk-… (Read-only management key) and ZG_SK=sk-… (API key) from the SAME pc.0g.ai account');
  process.exit(1);
}
const short = (v) => (typeof v === 'string' && /^0x[0-9a-f]{40}$/i.test(v) ? `${v.slice(0, 6)}…${v.slice(-4)}` : v);
const redact = (o) => JSON.parse(JSON.stringify(o, (_k, v) => short(v)));
async function get(path) {
  const r = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${MK}` }, signal: AbortSignal.timeout(20000) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
function flatten(o, p = '', out = {}) {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) flatten(v, p ? `${p}.${k}` : k, out);
  else if (typeof o === 'number' || (typeof o === 'string' && /^-?\d+(\.\d+)?$/.test(o))) out[p] = o;
  return out;
}
const today = new Date().toISOString().slice(0, 10);

console.log('== GET /account/balance');
const b0 = await get('/account/balance'); console.log(b0.status, JSON.stringify(redact(b0.body), null, 2));
for (const p of [`/account/usage/stats?start_date=${today}&end_date=${today}`, '/account/usage/history?limit=1']) {
  console.log(`\n== GET ${p}`);
  const r = await get(p); console.log(r.status, JSON.stringify(redact(r.body), null, 2)?.slice(0, 1500));
}
if (b0.status !== 200) { console.error('\nbalance read failed — check the mk- key has account:read (Read-only preset)'); process.exit(1); }

console.log('\n== one tiny chat call with the sk- key');
const t = Date.now();
const c = await fetch(`${base}/chat/completions`, {
  method: 'POST', headers: { authorization: `Bearer ${SK}`, 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.ZEROG_LLM_MODEL || 'deepseek-v4.1-flash', max_tokens: 20,
    messages: [{ role: 'user', content: 'Reply with one word: ok' }], chat_template_kwargs: { enable_thinking: false } }),
  signal: AbortSignal.timeout(60000),
});
const cj = await c.json().catch(() => ({}));
console.log(c.status, 'request id:', cj?.x_0g_trace?.request_id ?? c.headers.get('x-request-id'), 'usage:', JSON.stringify(cj?.usage), `${Date.now() - t}ms`);
if (!c.ok) console.log('error:', JSON.stringify(cj).slice(0, 300));

const before = { ...flatten(b0.body, 'balance') };
const s0 = await get(`/account/usage/stats?start_date=${today}&end_date=${today}`); Object.assign(before, flatten(s0.body, 'stats'));
console.log('\n== polling every 3 s for 45 s (fields that change are printed)');
for (let i = 1; i <= 15; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const b = await get('/account/balance'); const s = await get(`/account/usage/stats?start_date=${today}&end_date=${today}`);
  const now = { ...flatten(b.body, 'balance'), ...flatten(s.body, 'stats') };
  const changed = Object.keys(now).filter((k) => String(now[k]) !== String(before[k]));
  console.log(`t+${i * 3}s`, changed.length ? changed.map((k) => `${k}: ${before[k]} → ${now[k]}`).join(' | ') : 'no change');
}
console.log('\nDone. Paste this whole output (it contains no keys).');
