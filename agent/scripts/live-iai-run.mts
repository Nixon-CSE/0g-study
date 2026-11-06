#!/usr/bin/env -S npx tsx
// P5-iAI step 7: one real pod (photo → Note Reader → Tutor → Examiner) on a connected student's own
// pc.0g.ai account, with the balance before and after and the bill per request id.
//
//   cd agent && ./node_modules/.bin/tsx scripts/live-iai-run.mts [studentId]
//
// Needs the running stack, ZEROG_USER_ACCOUNTS=on, and a student connected in the app. Drives the agent
// like the backend does (admin token, the backend's own invocation text). Spends real credits (about
// $0.01). Reads that student's keys locally to read their balance; prints no keys.
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBalance, fetchUsageHistory, loadUserKeys, type AccountBalance } from '../src/study/zerog-account.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const AGENT_DIR = path.resolve(HERE, '../examples/default-agent');
const AGENT = process.env.AGENT_URL ?? 'http://localhost:7777';
const { prepareInvocationText } = await import('../../backend/src/agents/invoker.ts');
const { uploadIdsIn } = await import('../../backend/src/agents/upload-markers.ts');
const die = (m: string): never => { console.error(m); process.exit(1); };

const studyDir = path.join(AGENT_DIR, 'study');
const connected = fs.readdirSync(studyDir).filter((d) => fs.existsSync(path.join(studyDir, d, 'zerog-keys.enc')));
const student = process.argv[2] ?? (connected.length === 1 ? connected[0] : die(`Pick a student: ${connected.join(', ') || 'nobody has connected keys yet'}`));
process.env.ZEROG_USER_ACCOUNTS = 'on';
const keys = (await loadUserKeys(AGENT_DIR, student)) ?? die('Could not open those keys (is STUDY_JWT_SECRET the one they were saved with?)');

const money = (b: AccountBalance, v: bigint) => (b.currency === 'usd' ? `$${(Number(v) / 1e6).toFixed(6)}` : `${Number(v / 10n ** 12n) / 1e6} 0G`);
async function balance(label: string) {
  const r = await fetchBalance(keys.managementKey);
  if (!r.ok || !r.balance) return die(`${label}: balance read failed ${JSON.stringify(r)}`);
  const b = r.balance;
  console.log(`${label.padEnd(10)} available ${money(b, b.available)} · credit ${money(b, b.credit)} · deposit ${money(b, b.deposit)} · unsettled ${money(b, b.unsettled)}`);
  return b;
}

const admin: Record<string, string> = process.env.AGENT_ADMIN_TOKEN ? { 'x-agent-admin-token': process.env.AGENT_ADMIN_TOKEN } : {};
const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc({ sub: student, exp: Math.floor(Date.now() / 1000) + 600 });
const study = `${h}.${p}.${crypto.createHmac('sha256', process.env.STUDY_JWT_SECRET!).update(`${h}.${p}`).digest('base64url')}`;

async function chat(tenant: string, text: string, chatId: string, excludeUploadIds: string[]) {
  const r = await fetch(`${AGENT}/chat/message`, { method: 'POST', headers: { 'content-type': 'application/json', ...admin }, body: JSON.stringify({ userId: chatId, studentId: student, tenant, text, excludeUploadIds }) });
  if (!r.ok) die(`/chat/message ${r.status}`);
  const { streamId } = (await r.json()) as { streamId: string };
  const s = await fetch(`${AGENT}/chat/stream/${streamId}`, { signal: AbortSignal.timeout(300_000) });
  let out = '';
  for (const line of (await s.text()).split('\n')) if (line.startsWith('data: ')) { try { out += JSON.parse(line.slice(6)).chunk ?? ''; } catch { /* keep-alive */ } }
  return out;
}

const before = await balance('before');
const photo = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'scripts/fixtures/notes-sample.png')).toString('base64')}`;
const up = await fetch(`${AGENT}/uploads`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${study}` }, body: JSON.stringify({ dataUrl: photo }) });
if (!up.ok) die(`/uploads ${up.status}`);
const { id } = (await up.json()) as { id: string };

const POD = ['study-note-reader', 'study-tutor', 'study-examiner'];
const root = `@study-note-reader [[upload:${id}]]`;
const chatId = `bonfire:channel:live-iai-${Date.now().toString(36)}`;
const ids: string[] = [];
let parent: any = { content: root, authorType: 'user' }, speaker = `@${student}`;
for (const slug of POD) {
  const text = prepareInvocationText({ parent, target: { slug } as any, channel: { name: 'study' } as any, peerSlugs: POD, speakerLabel: speaker, speakerIsHuman: parent.authorType === 'user' });
  const reply = await chat(slug, text, chatId, uploadIdsIn(root));
  const entries = reply.match(/⟦0g:([^⟧]*)⟧\s*$/)?.[1].split(',') ?? [];
  console.log(`\n${slug}: ${entries.length} calls${reply.includes('**Flashcards**') ? ', flashcards attached' : ''}\n  ${reply.replace(/\s*⟦0g:[^⟧]*⟧\s*$/, '').slice(0, 140).replace(/\n/g, ' ')}…`);
  for (const e of entries) { ids.push(e.split('~')[0]); console.log(`  ${e}`); }
  if (!reply.includes(`@${POD[POD.indexOf(slug) + 1]}`) && slug !== 'study-examiner') { console.log('  (no hand-off: pod stopped here)'); break; }
  parent = { content: reply, authorType: 'agent' }; speaker = `@${slug}`;
}

console.log('');
const t0 = Date.now();
const at = async (s: number) => { await new Promise((r) => setTimeout(r, Math.max(0, t0 + s * 1000 - Date.now()))); return balance(`t+${s}s`); };
await at(3); const after = await at(8); await at(20);
const hist = await fetchUsageHistory(keys.managementKey);
if (!hist.ok) die(`usage history: ${JSON.stringify(hist)}`);
console.log(`\nbilled on this account (history currency ${hist.currency}):`);
let sum = 0;
for (const rid of ids) {
  const c = hist.calls.find((x) => x.requestId === rid);
  if (c) sum += Number(c.cost);
  console.log(`  ${rid}  ${c ? `cost ${c.cost} · credit ${c.creditUsed} · deposit ${c.depositUsed} · ${c.model}` : '— not in history yet'}`);
}
console.log(`\nbalance dropped ${money(before, before.available - after.available)}; matched cost ${sum}; ${ids.length} request ids`);
