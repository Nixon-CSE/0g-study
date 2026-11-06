#!/usr/bin/env node
// PRD step 1 — smoke-test 0G Private Computer (router API).
//   node scripts/smoke-router.mjs [path/to/notes.jpg]
// Reads ZEROG_API_KEY (+ optional ZEROG_BASE_URL, ZEROG_LLM_MODEL, ZEROG_VISION_MODEL) from agent/.env.
// Lists models, makes one chat and one vision completion, and prints response headers + body id
// so the request-id header (G2), model ids (G1) and vision input format (G9) can be confirmed.
// With a photo it sends read_notes' real prompt and max_tokens with the runtime's thinking-off field,
// and prints finish_reason and reasoning tokens; for notes-sample.png it fails unless all 5 keywords
// are read and the reply wasn't cut off.
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
// Same rule as withThinkingOff in src/providers/zerog-router.ts.
const thinkingOff = (model) => (/^gemini/i.test(model)
  ? { extra_body: { google: { thinking_config: { thinking_budget: 0 } } } }
  : /^(qwen|deepseek|glm|kimi|mimo|0gm)/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {});
const photo = process.argv[2];
// Keep in step with read_notes in src/tools/builtin/study.ts.
const READ_NOTES_PROMPT = 'Transcribe these study notes faithfully as clean markdown (keep headings, formulas, lists). Then list the 3-6 key concepts. Do not add facts that are not in the image.';
const SAMPLE_KEYWORDS = ['photosynthesis', 'calvin', 'rubisco', 'thylakoid', 'nadph'];

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
    ...thinkingOff(chatModel),
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
  }),
});
console.log('    body.id:', chat.body?.id, '| usage:', JSON.stringify(chat.body?.usage), '| reply:', JSON.stringify(chat.body?.choices?.[0]?.message?.content)?.slice(0, 120));
if (!chat.res.ok) console.log('    error body:', String(JSON.stringify(chat.body)).slice(0, 400));

const vision = await call(`POST /chat/completions vision (${visionModel})`, `${base}/chat/completions`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({
    model: visionModel, max_tokens: photo ? 1500 : 200,
    ...thinkingOff(visionModel),
    messages: [{ role: 'user', content: [
      { type: 'text', text: photo ? READ_NOTES_PROMPT : 'Describe this image in one short sentence. If it contains text, transcribe it.' },
      { type: 'image_url', image_url: { url: imageDataUrl(photo) } },
    ] }],
  }),
});
console.log('    body.id:', vision.body?.id, '| usage:', JSON.stringify(vision.body?.usage), '| reply:', JSON.stringify(vision.body?.choices?.[0]?.message?.content)?.slice(0, 300));
if (!vision.res.ok) console.log('    error body:', String(JSON.stringify(vision.body)).slice(0, 400));

let visionRead = true;
if (photo) {
  const choice = vision.body?.choices?.[0];
  const out = (choice?.message?.content ?? '').toLowerCase();
  console.log(`    finish_reason: ${choice?.finish_reason} | reasoning tokens: ${vision.body?.usage?.completion_tokens_details?.reasoning_tokens ?? 'n/a'} | chars: ${out.length}`);
  if (path.basename(photo).startsWith('notes-sample')) {
    const hits = SAMPLE_KEYWORDS.filter((w) => out.includes(w));
    console.log(`    keywords: ${hits.length}/${SAMPLE_KEYWORDS.length} (${hits.join(', ')})`);
    visionRead = hits.length === SAMPLE_KEYWORDS.length && choice?.finish_reason === 'stop';
  }
}

const ok = models.res.ok && chat.res.ok && vision.res.ok && visionRead;
console.log(`\n${ok ? 'OK' : 'FAILED'}: models=${models.res.status} chat=${chat.res.status} vision=${vision.res.status}${photo ? ` read=${visionRead}` : ''}`);
process.exit(ok ? 0 : 1);
