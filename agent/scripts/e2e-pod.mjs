#!/usr/bin/env node
// Live end-to-end check of the Study Pod against a running agent runtime and the real 0G router.
//
//   (terminal 1)  cd agent && pnpm dev          # needs ZEROG_API_KEY in agent/.env
//   (terminal 2)  cd agent && node scripts/e2e-pod.mjs path/to/notes.jpg
//
// Drives Note Reader -> Tutor -> Examiner over the agent HTTP API with inline tenants built from
// agent/examples/study-*, the way the backend's cascade does, and checks:
//   - the photo upload is accepted and read_notes produces a transcription
//   - every reply carries a ⟦0g:…⟧ request-id marker
//   - each stage hands off with the expected @-handle, and the Examiner ends the chain
//   - study_log ran: the student's streak/card count went up
// Optional env: AGENT_URL (default http://localhost:7777), STUDY_TOKEN (when STUDY_JWT_SECRET is set).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT = (process.env.AGENT_URL || 'http://localhost:7777').replace(/\/$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '../examples');
const img = process.argv[2];
if (!img) { console.error('usage: node scripts/e2e-pod.mjs <notes.jpg|png>'); process.exit(1); }
const student = `e2e${Date.now().toString(36)}`;
const auth = process.env.STUDY_TOKEN ? { authorization: `Bearer ${process.env.STUDY_TOKEN}` } : {};

const tenant = (slug, name) => ({
  slug, name, llm: { provider: 'zerog-router' },
  soul: fs.readFileSync(path.join(examples, slug, 'SOUL.md'), 'utf8'),
  agents: fs.readFileSync(path.join(examples, slug, 'AGENTS.md'), 'utf8'),
});

async function ask(t, text) {
  const t0 = Date.now();
  const r = await fetch(`${AGENT}/chat/message`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: `chan-${student}`, studentId: student, text, tenant: t }),
  });
  const { streamId } = await r.json();
  const res = await fetch(`${AGENT}/chat/stream/${streamId}`);
  let out = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      if (ev.startsWith('event: done')) return { text: out, ms: Date.now() - t0 };
      const line = ev.split('\n').find((l) => l.startsWith('data: '));
      if (line) { const { chunk } = JSON.parse(line.slice(6)); if (typeof chunk === 'string') out = chunk.length >= out.length && chunk.startsWith(out.slice(0, 20)) ? chunk : out + chunk; }
    }
  }
  return { text: out, ms: Date.now() - t0 };
}

const ids = (t) => (t.match(/⟦0g:([^⟧]*)⟧/)?.[1] ?? '').split(',').filter(Boolean);
const lastLine = (t) => t.replace(/\n*⟦0g:[^⟧]*⟧\s*$/, '').trim().split('\n').pop().trim();
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? '  ✓' : '  ✗'} ${label}`); if (!ok) failures++; };

const ext = path.extname(img).toLowerCase().replace('.', '').replace('jpg', 'jpeg');
const up = await fetch(`${AGENT}/uploads`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...auth },
  body: JSON.stringify({ dataUrl: `data:image/${ext};base64,${fs.readFileSync(img).toString('base64')}` }),
});
const upJson = await up.json();
check(up.ok && !!upJson.id, `upload accepted (${up.status})`);
const before = await (await fetch(`${AGENT}/study/index?user=${student}`, { headers: auth })).json();

console.log('\n── @study-note-reader');
const reader = await ask(tenant('study-note-reader', 'Note Reader'), `@study-note-reader here are today's notes\n[[upload:${upJson.id}]]`);
console.log(reader.text.slice(0, 700), `\n  (${reader.ms} ms)`);
check(ids(reader.text).length > 0, `request id(s): ${ids(reader.text).join(', ')}`);
check(!/couldn't read the notes/i.test(reader.text), 'notes were read');
check(lastLine(reader.text) === '@study-tutor', `hands off to @study-tutor (last line: "${lastLine(reader.text)}")`);

console.log('\n── @study-tutor');
const tutor = await ask(tenant('study-tutor', 'Tutor'), `[@study-note-reader → @study-tutor]\n${reader.text}`);
console.log(tutor.text.slice(0, 700), `\n  (${tutor.ms} ms)`);
check(ids(tutor.text).length > 0, `request id(s): ${ids(tutor.text).join(', ')}`);
check(lastLine(tutor.text) === '@study-examiner', `hands off to @study-examiner (last line: "${lastLine(tutor.text)}")`);

console.log('\n── @study-examiner');
const exam = await ask(tenant('study-examiner', 'Examiner'), `[@study-tutor → @study-examiner]\n${tutor.text}`);
console.log(exam.text.slice(0, 500), `\n  (${exam.ms} ms)`);
check(ids(exam.text).length > 0, `request id(s): ${ids(exam.text).join(', ')}`);
check(!/@study-[a-z-]+/.test(exam.text.replace(/⟦0g:[^⟧]*⟧/, '')), 'examiner mentions nobody (cascade ends)');

const after = await (await fetch(`${AGENT}/study/index?user=${student}`, { headers: auth })).json();
check(after.today > before.today, `study_log ran: cards today ${before.today} → ${after.today}, streak ${after.streak}`);
const usage = await (await fetch(`${AGENT}/usage`, { headers: auth })).json();
console.log(`\nusage today: ${usage.calls} calls, ${usage.tokens} tokens`);
console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
process.exit(failures ? 1 : 0);
