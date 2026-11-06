#!/usr/bin/env node
// P4: which 0G router models are served by a Private (TEE) provider, and could the pod use them?
//
//   node scripts/smoke-private.mjs [model ...]          default: our chat + vision + embedding models and
//                                                        the TEE-attested chat models that support tools
//   node scripts/smoke-private.mjs --tutor [model ...]   also one Tutor-style prompt (must call study_log)
//   node scripts/smoke-private.mjs --vision [model ...]  also read scripts/fixtures/notes-sample.png (image models)
//
// Per model it reports, verbatim from 0G (nothing inferred):
//   metadata (GET /v1/models): verifiability (TeeML / TeeTLS / none), tee_type, tool support, image input, price
//   response: HTTP status, latency, the `x-0g-e2ee` header, `x-provider`, and x_0g_trace.provider_identity / billing
//   tools:    whether the model returned a tool call when asked to use one
// A few small requests per model (≈ a cent in total). Reads ZEROG_API_KEY from agent/.env; never prints it.
// Writes .logs/smoke-private.json at the repo root.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = (process.env.ZEROG_BASE_URL || 'https://router-api.0g.ai/v1').replace(/\/$/, '');
const key = process.env.ZEROG_API_KEY;
if (!key) { console.error('ZEROG_API_KEY is not set (agent/.env)'); process.exit(1); }
const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const TUTOR = process.argv.includes('--tutor');
const VISION = process.argv.includes('--vision');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

async function call(p, body, timeoutMs = 120_000) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}${p}`, { method: 'POST', headers: auth, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, ms: Date.now() - t0, headers: res.headers, json, text };
    } catch (e) {
      if (attempt === 2) return { status: 0, ms: Date.now() - t0, headers: new Headers(), json: null, text: String(e?.cause?.code ?? e?.name ?? e) };
    }
  }
}

/** What the response itself says about where it ran. Verbatim; absent fields are null. */
function markers(r) {
  const tr = r.json?.x_0g_trace ?? null;
  return {
    status: r.status,
    ms: r.ms,
    e2ee: r.headers.get('x-0g-e2ee'),
    provider: r.headers.get('x-provider') ?? tr?.provider ?? null,
    providerIdentity: tr?.provider_identity ?? null,
    costUsdMicro: tr?.billing?.total_cost_usd_micro ?? null,
    requestId: tr?.request_id ?? null,
    error: r.status === 200 ? null : (r.json?.error?.message ?? r.text).slice(0, 160),
  };
}

const perM = (usd) => (usd == null ? null : Math.round(Number(usd) * 1e6 * 1000) / 1000); // $ per 1M tokens

const models = (await (await fetch(`${base}/models`, { headers: auth, signal: AbortSignal.timeout(30_000) })).json()).data ?? [];
const meta = Object.fromEntries(models.map((m) => [m.id, m]));
const defaults = [
  process.env.ZEROG_LLM_MODEL || 'deepseek-v4.1-flash',
  process.env.ZEROG_VISION_MODEL || 'qwen2.5-vl-72b-instruct',
  process.env.ZEROG_EMBED_MODEL || 'qwen3-embedding-0.6b',
  ...models.filter((m) => m.type === 'chatbot' && m.verifiability && (m.supported_parameters ?? []).includes('tools')).map((m) => m.id),
];
const targets = [...new Set(args.length ? args : defaults)];

const NOTES = '# Photosynthesis\n- Light reactions in the thylakoids make ATP and NADPH; water is split, O2 released.\n- Calvin cycle in the stroma: RuBisCO fixes CO2 onto RuBP; ATP + NADPH reduce it to G3P → glucose.';
const tool = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TIME_TOOL = tool('get_utc_time', 'Returns the current UTC time.', {}, []);
const STUDY_LOG = tool('study_log', "Save flashcards for today to the student's study log.", {
  topic: { type: 'string' },
  cards: { type: 'array', items: { type: 'object', properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] } },
}, ['topic', 'cards']);

const results = [];
for (const id of targets) {
  const m = meta[id];
  const params = m?.supported_parameters ?? [];
  const row = {
    model: id,
    listed: !!m,
    type: m?.type ?? null,
    verifiability: m?.verifiability ?? null,
    teeType: m?.tee_type ?? null,
    tools: params.includes('tools'),
    imageInput: (m?.architecture?.input_modalities ?? []).includes('image'),
    pricePer1M: { input: perM(m?.pricing_usd?.prompt), output: perM(m?.pricing_usd?.completion) },
  };
  console.log(`\n== ${id}  [metadata: ${row.verifiability ?? 'no verifiability'}${row.teeType ? ` / ${row.teeType}` : ''}, tools ${row.tools ? 'yes' : 'no'}, image ${row.imageInput ? 'yes' : 'no'}, $${row.pricePer1M.input}/$${row.pricePer1M.output} per 1M in/out]`);
  // Thinking off where the model accepts it (same rule as the runtime), so answers stay short.
  const extra = params.includes('chat_template_kwargs') ? { chat_template_kwargs: { enable_thinking: false } } : {};

  if (m?.type === 'embedding') {
    row.basic = markers(await call('/embeddings', { model: id, input: 'hello world' }));
  } else {
    row.basic = markers(await call('/chat/completions', { model: id, messages: [{ role: 'user', content: 'Reply with one word: OK' }], max_tokens: 16, ...extra }));
    if (row.tools && row.basic.status === 200) {
      const r = await call('/chat/completions', { model: id, max_tokens: 200, tools: [TIME_TOOL], tool_choice: 'auto', ...extra,
        messages: [{ role: 'user', content: 'What is the current UTC time? Use the tool.' }] });
      row.toolCall = { ...markers(r), called: r.json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name ?? null };
    }
    if (TUTOR && row.tools && row.basic.status === 200) {
      const rules = fs.readFileSync(path.join(ROOT, 'agent/examples/study-tutor/AGENTS.md'), 'utf8');
      const soul = fs.readFileSync(path.join(ROOT, 'agent/examples/study-tutor/SOUL.md'), 'utf8');
      const r = await call('/chat/completions', { model: id, max_tokens: 1500, tools: [STUDY_LOG], tool_choice: 'auto', ...extra,
        messages: [{ role: 'system', content: `${soul}\n\n${rules}` }, { role: 'user', content: `@study-note-reader said:\n${NOTES}\n\n@study-tutor` }] });
      const msg = r.json?.choices?.[0]?.message;
      const tc = msg?.tool_calls?.find((t) => t.function?.name === 'study_log');
      let cards = null; try { cards = JSON.parse(tc?.function?.arguments ?? 'null')?.cards?.length ?? null; } catch { /* bad args */ }
      row.tutor = { ...markers(r), studyLogCalled: !!tc, cards, textChars: (msg?.content ?? '').length, tokens: r.json?.usage?.total_tokens ?? null };
    }
    if (VISION && row.imageInput && row.basic.status === 200) {
      const img = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'scripts/fixtures/notes-sample.png')).toString('base64')}`;
      const r = await call('/chat/completions', { model: id, max_tokens: 800, ...extra, messages: [{ role: 'user', content: [
        { type: 'text', text: 'Transcribe these study notes faithfully as clean markdown. Then list the 3-6 key concepts.' },
        { type: 'image_url', image_url: { url: img } },
      ] }] });
      const out = (r.json?.choices?.[0]?.message?.content ?? '').toLowerCase();
      row.vision = { ...markers(r), keywords: ['photosynthesis', 'calvin', 'rubisco', 'thylakoid', 'nadph'].filter((w) => out.includes(w)).length };
    }
  }
  for (const k of ['basic', 'toolCall', 'tutor', 'vision']) {
    const x = row[k];
    if (!x) continue;
    const bits = [`HTTP ${x.status}`, `${x.ms} ms`, `e2ee=${x.e2ee ?? '-'}`, `provider_identity=${x.providerIdentity ?? '-'}`, x.costUsdMicro != null ? `cost=${x.costUsdMicro} µ$` : null,
      k === 'toolCall' ? `tool_call=${x.called ?? 'none'}` : null,
      k === 'tutor' ? `study_log=${x.studyLogCalled ? `yes (${x.cards} cards)` : 'no'}, ${x.tokens} tokens` : null,
      k === 'vision' ? `notes keywords ${x.keywords}/5` : null, x.error ? `error: ${x.error}` : null].filter(Boolean);
    console.log(`  ${k.padEnd(8)} ${bits.join(' · ')}`);
  }
  results.push(row);
}

fs.mkdirSync(path.join(ROOT, '.logs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.logs/smoke-private.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log('\nwritten .logs/smoke-private.json');
