#!/usr/bin/env node
// PRD step 1 — smoke-test 0G Private Computer (router API).
//   node scripts/smoke-router.mjs [path/to/notes.jpg]
// Reads ZEROG_API_KEY (+ optional ZEROG_BASE_URL, ZEROG_LLM_MODEL, ZEROG_VISION_MODEL) from agent/.env.
// Lists models, makes one chat and one vision completion, and prints response headers + body id
// so the request-id header (G2), model ids (G1) and vision input format (G9) can be confirmed.
// Never prints the API key.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const base = (process.env.ZEROG_BASE_URL || 'https://router-api.0g.ai/v1').replace(/\/$/, '');
const key = process.env.ZEROG_API_KEY;
if (!key) { console.error('ZEROG_API_KEY is not set (agent/.env)'); process.exit(1); }
const chatModel = process.env.ZEROG_LLM_MODEL || 'deepseek-v4.1-flash';
const visionModel = process.env.ZEROG_VISION_MODEL || 'qwen2.5-vl-72b-instruct';
const auth = { authorization: `Bearer ${key}` };

// 1x1 white PNG fallback; pass a real notes photo for a meaningful vision check.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
function imageDataUrl(p) {
  if (!p) return TINY_PNG;
  const ext = path.extname(p).toLowerCase().replace('.', '').replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(p).toString('base64')}`;
}

function showHeaders(res) {
  const keep = [...res.headers.entries()].filter(([k]) => /request|id|trace|0g|x-/i.test(k));
  for (const [k, v] of keep) console.log(`    ${k}: ${v}`);
}

async function call(label, url, init, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      const text = await res.text();
      console.log(`\n== ${label}: HTTP ${res.status} (${Date.now() - t0} ms)`);
      showHeaders(res);
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { res, body };
    } catch (e) {
      console.log(`\n== ${label}: attempt ${i}/${attempts} failed after ${Date.now() - t0} ms: ${e?.cause?.code ?? e?.name ?? e}`);
    }
  }
  return { res: { ok: false, status: 'network-error' }, body: null };
}

const models = await call('GET /models', `${base}/models`, { headers: auth });
if (models.res.ok && Array.isArray(models.body?.data)) {
  console.log('    models:', models.body.data.map((m) => m.id).join(', '));
} else {
  console.log('    body:', String(JSON.stringify(models.body)).slice(0, 400));
}

const chat = await call(`POST /chat/completions (${chatModel})`, `${base}/chat/completions`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: chatModel, max_tokens: 60,
    chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
  }),
});
console.log('    body.id:', chat.body?.id, '| usage:', JSON.stringify(chat.body?.usage), '| reply:', JSON.stringify(chat.body?.choices?.[0]?.message?.content)?.slice(0, 120));
if (!chat.res.ok) console.log('    error body:', String(JSON.stringify(chat.body)).slice(0, 400));

const vision = await call(`POST /chat/completions vision (${visionModel})`, `${base}/chat/completions`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: visionModel, max_tokens: 200,
    chat_template_kwargs: { enable_thinking: false },
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Describe this image in one short sentence. If it contains text, transcribe it.' },
      { type: 'image_url', image_url: { url: imageDataUrl(process.argv[2]) } },
    ] }],
  }),
});
console.log('    body.id:', vision.body?.id, '| usage:', JSON.stringify(vision.body?.usage), '| reply:', JSON.stringify(vision.body?.choices?.[0]?.message?.content)?.slice(0, 300));
if (!vision.res.ok) console.log('    error body:', String(JSON.stringify(vision.body)).slice(0, 400));

const ok = models.res.ok && chat.res.ok && vision.res.ok;
console.log(`\n${ok ? 'OK' : 'FAILED'}: models=${models.res.status} chat=${chat.res.status} vision=${vision.res.status}`);
process.exit(ok ? 0 : 1);
