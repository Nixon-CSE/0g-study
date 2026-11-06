#!/usr/bin/env node
// RAG phase 0: smoke-test 0G Private Computer embeddings (router API).
//   node scripts/smoke-embeddings.mjs [model ...]
//   node scripts/smoke-embeddings.mjs --quick [model]   one call to the configured model (ZEROG_EMBED_MODEL);
//       prints "0G embeddings up" / "0G embeddings down" and exits 0 (up), 2 (down: network, 429, 5xx), 1 (other).
//       run-tests.sh runs this before the live E2E.
// Reads ZEROG_API_KEY (+ optional ZEROG_BASE_URL) from agent/.env. Never prints the key.
// For each model it checks: a single input, a batch (input: string[]), the vector dimension,
// the request-id headers, latency, a long input (max length), whether chat_template_kwargs is
// rejected, and a tiny retrieval-quality check on sample study notes.
import 'dotenv/config';

const base = (process.env.ZEROG_BASE_URL || 'https://router-api.0g.ai/v1').replace(/\/$/, '');
const key = process.env.ZEROG_API_KEY;
if (!key) { console.error('ZEROG_API_KEY is not set (agent/.env)'); process.exit(1); }
const QUICK = process.argv.includes('--quick');
const args = process.argv.slice(2).filter((a) => a !== '--quick');
const models = args.length ? args : QUICK ? [process.env.ZEROG_EMBED_MODEL || 'qwen3-embedding-0.6b'] : ['qwen3-embedding-0.6b', 'qwen3-embedding-8b'];
const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

async function embed(model, input, extra = {}, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST', headers: auth, body: JSON.stringify({ model, input, ...extra }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, ok: res.ok, ms: Date.now() - t0, headers: res.headers, body };
    } catch (e) {
      console.log(`    attempt ${i}/${attempts} failed after ${Date.now() - t0} ms: ${e?.cause?.code ?? e?.name ?? e}`);
    }
  }
  return { status: 'network-error', ok: false, ms: 0, headers: new Headers(), body: null };
}

const cos = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
const err = (r) => String(JSON.stringify(r.body)).slice(0, 300);

const NOTES = [
  'Photosynthesis converts light energy into chemical energy. 6CO2 + 6H2O -> C6H12O6 + 6O2, in the chloroplasts.',
  'Newton\'s second law: F = m a. The net force on a body equals its mass times its acceleration.',
  'The French Revolution began in 1789 with the storming of the Bastille.',
];
const QUERIES = [
  ['How do plants make glucose from sunlight?', 0],
  ['What is the relation between force and acceleration?', 1],
  ['When did the Bastille fall?', 2],
];

const results = {};
if (QUICK) {
  const model = models[0];
  let status = 0, detail = '';
  try {
    const res = await fetch(`${base}/embeddings`, { method: 'POST', headers: auth, body: JSON.stringify({ model, input: 'hello world' }), signal: AbortSignal.timeout(30_000) });
    status = res.status;
    detail = res.ok ? '' : (await res.text()).slice(0, 200);
  } catch (e) { detail = String(e?.cause?.code ?? e?.name ?? e); }
  if (status === 200) { console.log(`0G embeddings up (${model})`); process.exit(0); }
  const down = status === 0 || status === 429 || status >= 500;
  console.log(`0G embeddings ${down ? 'down' : 'error'} (${model}): ${status ? `HTTP ${status}` : 'network'} ${detail}`);
  process.exit(down ? 2 : 1);
}

for (const model of models) {
  console.log(`\n== ${model}`);
  const r = { model };
  const one = await embed(model, 'hello world');
  r.single = one.status;
  if (!one.ok) { console.log(`  single: HTTP ${one.status} ${err(one)}`); results[model] = r; continue; }
  const v = one.body?.data?.[0]?.embedding;
  r.dim = Array.isArray(v) ? v.length : null;
  r.latencyMs = one.ms;
  r.requestIdHeaders = [...one.headers.entries()].filter(([k]) => /request-id/i.test(k)).map(([k, val]) => `${k}: ${val}`);
  r.bodyId = one.body?.id ?? null;
  r.usage = one.body?.usage ?? null;
  console.log(`  single: HTTP 200, dim ${r.dim}, ${one.ms} ms, usage ${JSON.stringify(r.usage)}`);
  console.log(`  request-id headers: ${r.requestIdHeaders.join(' | ') || '(none)'}; body.id: ${r.bodyId}`);

  const batch = await embed(model, NOTES);
  r.batch = batch.ok ? `${batch.body?.data?.length} vectors, ${batch.ms} ms` : `HTTP ${batch.status} ${err(batch)}`;
  console.log(`  batch of ${NOTES.length}: ${r.batch}`);

  const kw = await embed(model, 'hello', { chat_template_kwargs: { enable_thinking: false } });
  r.chatTemplateKwargs = kw.ok ? 'accepted (ignored)' : `rejected HTTP ${kw.status}`;
  console.log(`  with chat_template_kwargs: ${r.chatTemplateKwargs}`);

  for (const words of [2000, 6000, 12000]) {
    const long = await embed(model, Array.from({ length: words }, (_, i) => `word${i % 97}`).join(' '));
    console.log(`  long input ~${words} words: ${long.ok ? `HTTP 200 (${long.ms} ms, tokens ${long.body?.usage?.prompt_tokens ?? '?'})` : `HTTP ${long.status} ${err(long)}`}`);
    r[`long${words}`] = long.status;
    if (!long.ok) break;
  }

  if (batch.ok) {
    const docVecs = batch.body.data.map((d) => d.embedding);
    const q = await embed(model, QUERIES.map((x) => x[0]));
    if (q.ok) {
      let hits = 0;
      q.body.data.forEach((d, i) => {
        const scores = docVecs.map((dv) => cos(d.embedding, dv));
        const best = scores.indexOf(Math.max(...scores));
        if (best === QUERIES[i][1]) hits++;
        console.log(`  quality: "${QUERIES[i][0]}" -> note #${best} (scores ${scores.map((s) => s.toFixed(3)).join(', ')})`);
      });
      r.quality = `${hits}/${QUERIES.length}`;
    }
  }
  results[model] = r;
}

console.log('\nSUMMARY');
console.log(JSON.stringify(results, null, 2));
const ok = models.every((m) => results[m]?.single === 200);
process.exit(ok ? 0 : 1);
