// PRD step 8 — bring a fresh clone to the Study Pod demo state in one command.
//
//   cd backend
//   pnpm tsx scripts/seed-study-pod.mjs --owner <username-or-email>
//
// Idempotent. It:
//   1. registers the three pod personas as tenants on the agent runtime (POST/PATCH /tenants),
//      reading SOUL.md + AGENTS.md from agent/examples/study-*  (provider: zerog-router);
//   2. creates the matching AgentDocs in Mongo (slugs study-note-reader / study-tutor / study-examiner);
//   3. creates a "Study" server owned by --owner (the user must have signed in once via Privy),
//      a #study text channel, and invites the three agents as server members.
//
// Env: MONGODB_URI, MONGODB_DB (default bonfire), EMBER_AGENT_BASE_URL (default http://localhost:7777).
// EMBER_AGENT_BASE_URL is the origin the BACKEND uses, stored on each agent. On Railway that can be a
// private *.railway.internal address your laptop can't reach, so AGENT_PUBLIC_URL (default: the same)
// is where this script registers the tenants. For production use ./seed-production.sh.
// The agent runtime must be running so the tenants can be registered.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { createServer, findServerByIdOrSlug, findMembership, addMember } from '../src/servers/service.js';
import { createChannel } from '../src/channels/service.js';
import { createAgent, findAgentByIdOrSlug } from '../src/agents/registry.js';
import { collections } from '../src/db/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const examples = path.resolve(here, '../../agent/examples');
const AGENT_BASE_URL = (process.env.EMBER_AGENT_BASE_URL || 'http://localhost:7777').replace(/\/$/, '');
const AGENT_REACHABLE_URL = (process.env.AGENT_PUBLIC_URL || AGENT_BASE_URL).replace(/\/$/, '');
const ADMIN = process.env.AGENT_ADMIN_TOKEN ? { 'x-agent-admin-token': process.env.AGENT_ADMIN_TOKEN } : {};

const POD = [
  { slug: 'study-note-reader', dir: 'study-note-reader', name: 'Note Reader', description: 'Reads a photo of your notes with 0G vision and turns it into clean notes plus key concepts.', tags: ['study', 'vision'] },
  { slug: 'study-tutor', dir: 'study-tutor', name: 'Tutor', description: 'Explains the hardest ideas in plain language and writes flashcards that count toward your streak.', tags: ['study'] },
  { slug: 'study-examiner', dir: 'study-examiner', name: 'Examiner', description: 'Quizzes you one question at a time and grades your answers.', tags: ['study'], model: process.env.ZEROG_EXAMINER_MODEL || '0gm-1.0-35b-a3b' },
];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const ownerIdent = arg('owner');
if (!ownerIdent) {
  console.error('usage: pnpm tsx scripts/seed-study-pod.mjs --owner <username-or-email>');
  process.exit(1);
}
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set'); process.exit(1); }

async function upsertTenant(p) {
  const read = (f) => fs.readFileSync(path.join(examples, p.dir, f), 'utf8');
  const body = {
    slug: p.slug, name: p.name, description: p.description, tags: p.tags,
    soul: read('SOUL.md'), agents: read('AGENTS.md'), llm: { provider: 'zerog-router', ...(p.model ? { model: p.model } : {}) },
  };
  const post = await fetch(`${AGENT_REACHABLE_URL}/tenants`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...ADMIN }, body: JSON.stringify(body),
  });
  if (post.ok) return 'created';
  if (post.status !== 409) throw new Error(`POST /tenants ${p.slug}: HTTP ${post.status} ${await post.text()}`);
  const { slug: _s, ...patch } = body;
  const res = await fetch(`${AGENT_REACHABLE_URL}/tenants/${p.slug}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...ADMIN }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`PATCH /tenants/${p.slug}: HTTP ${res.status} ${await res.text()}`);
  return 'updated';
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB ?? 'bonfire');
try {
  const users = db.collection(collections.users);
  const humans = await users.find({ isService: { $ne: true } }, { projection: { username: 1, email: 1, privyDid: 1 } }).toArray();
  let owner = ownerIdent === 'auto'
    ? (humans.length === 1 ? humans[0] : null)
    : await users.findOne({ $or: [{ username: ownerIdent.toLowerCase() }, { email: ownerIdent.toLowerCase() }] });
  if (!owner) {
    if (humans.length === 0) {
      throw new Error('nobody has signed in yet — open http://localhost:3000, sign in, then run the seed again');
    }
    console.error(`no user "${ownerIdent}". Signed-in users:`);
    for (const u of humans) console.error(`  username: ${u.username}   email: ${u.email ?? '(none — wallet/social login)'}`);
    console.error(humans.length === 1 ? 'Tip: ./run-local.sh seed auto' : 'Re-run with one of the usernames above.');
    process.exit(1);
  }
  console.log(`owner: ${owner.username} (${owner._id.toHexString()})`);

  // 1 + 2: tenants on the runtime, AgentDocs in Mongo.
  const agentDocs = [];
  for (const p of POD) {
    console.log(`tenant ${p.slug}: ${await upsertTenant(p)}`);
    let a = await findAgentByIdOrSlug(db, p.slug);
    if (!a) {
      ({ agent: a } = await createAgent(db, {
        name: p.name, slug: p.slug, description: p.description, tags: p.tags,
        baseUrl: AGENT_BASE_URL, createdBy: owner._id,
      }));
      console.log(`agent ${p.slug}: created`);
    } else {
      console.log(`agent ${p.slug}: exists`);
      if (a.baseUrl !== AGENT_BASE_URL) {
        await db.collection(collections.agents).updateOne({ _id: a._id }, { $set: { baseUrl: AGENT_BASE_URL } });
        console.log(`  baseUrl updated to ${AGENT_BASE_URL}`);
      }
    }
    agentDocs.push(a);
  }

  // 3: server, #study channel, memberships.
  let server = await findServerByIdOrSlug(db, 'study');
  if (!server) {
    ({ server } = await createServer(db, { name: 'Study', slug: 'study', ownerId: owner._id }));
    console.log('server study: created');
  } else {
    console.log('server study: exists');
    if (!(await findMembership(db, server._id, 'user', owner._id))) {
      await addMember(db, { serverId: server._id, principalType: 'user', principalId: owner._id, role: 'admin' });
      console.log(`  added ${owner.username} as admin`);
    }
  }
  let channel = await db.collection(collections.channels).findOne({ serverId: server._id, name: 'study' });
  if (!channel) {
    channel = await createChannel(db, {
      serverId: server._id, name: 'study', position: 1,
      topic: 'Attach a photo of your notes and mention @study-note-reader',
    });
    console.log('channel #study: created');
  } else {
    console.log('channel #study: exists');
  }
  for (const a of agentDocs) {
    if (!(await findMembership(db, server._id, 'agent', a._id))) {
      await addMember(db, { serverId: server._id, principalType: 'agent', principalId: a._id });
      console.log(`  invited @${a.slug}`);
    }
  }
  console.log(`\ndone. Open the app → server "Study" → #study, attach a notes photo and send "@study-note-reader".`);
} finally {
  await client.close();
}
