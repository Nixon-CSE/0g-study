// E2E test for the invite-agent flow.
// Invariants verified (no real Daily/Pipecat needed — only HTTP layer):
//   1. POST /voice/join does NOT spawn a bot (session.bots is empty)
//   2. POST /voice/invite-agent for an INFT agent → adds to session.bots
//   3. Inviting the same agent twice → 409 agent_already_in_room
//   4. POST /voice/kick-agent removes the bot
//   5. /voice/status reflects the bots list
//
// Runs against a LIVE backend on :8080. Requires a real Privy token (the
// E2E user) — set BONFIRE_E2E_TOKEN env var. Without that the script
// exits with a soft warning rather than failing.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const BACKEND = process.env.BONFIRE_BACKEND ?? 'http://localhost:8080';
const TOKEN = process.env.BONFIRE_E2E_TOKEN;
const MONGO = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
const DB = process.env.MONGODB_DB ?? 'bonfire';

const log = (...a) => console.log('[invite-e2e]', ...a);
const fail = (...a) => { log('✗', ...a); process.exit(1); };
const pass = (...a) => log('✓', ...a);

if (!TOKEN) {
  log('SKIP: BONFIRE_E2E_TOKEN not set. Grab a Privy access token from the browser dev tools or use the existing /v1/auth/privy/verify flow.');
  process.exit(0);
}

async function http(method, path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function pickVoiceChannelAndInftAgent() {
  const c = new MongoClient(MONGO);
  await c.connect();
  const db = c.db(DB);
  const ch = await db.collection('channels').findOne({ type: 'voice' });
  const agent = await db.collection('agents').findOne({ tokenId: { $exists: true } });
  await c.close();
  if (!ch) fail('no voice channel in DB');
  if (!agent) fail('no INFT-backed agent available to invite');
  return { ch, agent };
}

const { ch, agent } = await pickVoiceChannelAndInftAgent();
const cid = ch._id.toHexString();
log('channel:', cid, '| agent:', agent.slug, '(tokenId:', agent.tokenId, ')');

// 1. join
log('1. /voice/join...');
const j = await http('POST', `/v1/channels/${cid}/voice/join`, {});
if (j.status !== 200) fail('join failed', j.status, JSON.stringify(j.body).slice(0, 200));
if (!j.body.sessionId || !j.body.roomUrl || !j.body.token) fail('missing join fields');
pass('join ok — session', j.body.sessionId.slice(0, 8));

// 2. status — bots should be empty
const s1 = await http('GET', `/v1/channels/${cid}/voice/status`);
if (s1.status !== 200) fail('status1', s1.status);
const bots1 = s1.body.bots ?? [];
if (bots1.length !== 0) fail('expected empty bots after join, got', bots1.length);
pass('status after join: bots=[]');

// 3. invite
log('3. /voice/invite-agent...');
const inv = await http('POST', `/v1/channels/${cid}/voice/invite-agent`, {
  sessionId: j.body.sessionId, agentSlug: agent.slug,
});
if (inv.status !== 200) fail('invite failed', inv.status, JSON.stringify(inv.body).slice(0, 300));
pass('invite ok — bot:', JSON.stringify(inv.body.bot));

// 4. duplicate invite → 409
const dup = await http('POST', `/v1/channels/${cid}/voice/invite-agent`, {
  sessionId: j.body.sessionId, agentSlug: agent.slug,
});
if (dup.status !== 409) fail('expected 409 on duplicate, got', dup.status);
pass('duplicate invite → 409 as expected');

// 5. status — bot in list
const s2 = await http('GET', `/v1/channels/${cid}/voice/status`);
const bots2 = s2.body.bots ?? [];
const matched = bots2.find(b => b.agentSlug === agent.slug);
if (!matched) fail('agent not in bots[] after invite');
pass('status reflects invited bot');

// 6. kick
const k = await http('POST', `/v1/channels/${cid}/voice/kick-agent`, {
  sessionId: j.body.sessionId, agentSlug: agent.slug,
});
if (k.status !== 200) fail('kick failed', k.status);
pass('kick ok');

// 7. status — bots empty again
const s3 = await http('GET', `/v1/channels/${cid}/voice/status`);
if ((s3.body.bots ?? []).length !== 0) fail('bots not empty after kick');
pass('status after kick: bots=[]');

// 8. leave
const l = await http('POST', `/v1/channels/${cid}/voice/leave`, { sessionId: j.body.sessionId });
if (l.status !== 200) fail('leave failed', l.status);
pass('leave ok — ended=' + l.body.ended);

log('\n✅ INVITE-AGENT E2E FLOW PASSED');
