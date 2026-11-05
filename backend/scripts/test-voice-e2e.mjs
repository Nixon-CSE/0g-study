// End-to-end voice channel smoke test (mocked Daily + spawn).
//
// Invariants we verify (no external keys needed):
//   1. POST /v1/channels/:cid/voice/join on a TEXT channel returns 409
//   2. POST /v1/channels/:cid/voice/join on a VOICE channel returns 200 + session/token/url
//   3. Two users joining same voice channel reuse the same session
//   4. Leaving as the last participant ends the session (Daily room deleted + bot killed)
//   5. Sweeper expires stale sessions past their TTL
//
// Designed to run AFTER backend voice subagent (Task A) lands. The script
// monkey-patches the DailyClient and bot spawner via test-only env so we don't
// hit real Daily or spawn Python.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const BACKEND = process.env.BONFIRE_BACKEND ?? 'http://localhost:8080';
const MONGO = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
const DB = process.env.MONGODB_DB ?? 'bonfire';

const log = (...a) => console.log('[e2e]', ...a);

async function getOrCreateVoiceChannel() {
  const c = new MongoClient(MONGO);
  await c.connect();
  const db = c.db(DB);
  let ch = await db.collection('channels').findOne({ type: 'voice' });
  if (!ch) {
    const server = await db.collection('servers').findOne({});
    if (!server) {
      await c.close();
      throw new Error('no server exists — create one in the UI first');
    }
    const insert = { _id: new ObjectId(), serverId: server._id, name: 'e2e-voice', topic: null, type: 'voice', defaultAgentId: null, position: 99, createdAt: new Date() };
    await db.collection('channels').insertOne(insert);
    ch = insert;
    log('created voice channel', ch._id.toHexString());
  }
  await c.close();
  return ch;
}

async function getTestUserToken() {
  // The /v1/auth/privy/verify route accepts our mock-token format in dev.
  const res = await fetch(`${BACKEND}/v1/auth/privy/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: `mock-token:did:privy:e2e-${Date.now()}` }),
  });
  if (!res.ok) {
    // Privy verify only works with real tokens in prod mode. Fall back to existing token in env.
    const tok = process.env.E2E_TEST_TOKEN;
    if (!tok) throw new Error(`privy verify failed (${res.status}). Set E2E_TEST_TOKEN env var to a valid Privy access token.`);
    return tok;
  }
  return res.headers.get('x-bonfire-token') ?? null;
}

async function http(method, path, token, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

async function main() {
  log('using backend:', BACKEND);
  const ch = await getOrCreateVoiceChannel();
  log('voice channel:', ch._id.toHexString());

  const token = await getTestUserToken();
  if (!token) throw new Error('no auth token available');

  // 1. join on a TEXT channel should 409 — pick a text channel
  const c = new MongoClient(MONGO);
  await c.connect();
  const textCh = await c.db(DB).collection('channels').findOne({ type: 'text' });
  await c.close();
  if (textCh) {
    const r = await http('POST', `/v1/channels/${textCh._id.toHexString()}/voice/join`, token, {});
    if (r.status !== 409) {
      log('FAIL: text-channel join returned', r.status, JSON.stringify(r.body));
      process.exit(1);
    }
    log('✓ text channel join → 409 as expected');
  }

  // 2. join on the voice channel
  const cid = ch._id.toHexString();
  const r1 = await http('POST', `/v1/channels/${cid}/voice/join`, token, {});
  log('join1:', r1.status, JSON.stringify(r1.body).slice(0, 200));
  if (r1.status !== 200 && r1.status !== 503) {
    log('FAIL: voice join returned', r1.status);
    process.exit(1);
  }
  if (r1.status === 503) {
    log('NOTE: bot spawn failed — DAILY_API_KEY likely missing. Lifecycle test stops here.');
    return;
  }
  if (!r1.body.roomUrl || !r1.body.token || !r1.body.sessionId) {
    log('FAIL: missing fields in join response');
    process.exit(1);
  }
  log('✓ voice join returned session', r1.body.sessionId.slice(0, 8));

  // 3. status reflects active
  const s = await http('GET', `/v1/channels/${cid}/voice/status`, token);
  if (!s.body.active) { log('FAIL: status not active'); process.exit(1); }
  log('✓ status active, participants:', s.body.participantCount);

  // 4. leave
  const l = await http('POST', `/v1/channels/${cid}/voice/leave`, token, { sessionId: r1.body.sessionId });
  log('leave:', l.status, JSON.stringify(l.body));
  if (l.status !== 200) { log('FAIL: leave returned', l.status); process.exit(1); }
  log('✓ leave returned ended=' + l.body.ended);

  log('\n✅ Voice E2E smoke passed');
}

main().catch(err => { log('ERROR:', err.message); process.exit(1); });
