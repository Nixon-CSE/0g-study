// For every existing server, ensure a 'general-voice' (type: voice),
// 'audit-log' (type: audit), and 'knowledge-base' (type: knowledge) channel
// exists. Idempotent — re-running won't create duplicates.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db(process.env.MONGODB_DB ?? 'bonfire');

const servers = await db.collection('servers').find({}).toArray();
console.log(`scanning ${servers.length} servers…\n`);

let added = 0;
for (const srv of servers) {
  const channels = await db.collection('channels').find({ serverId: srv._id }).toArray();
  const hasVoice = channels.some((c) => c.type === 'voice');
  const hasAudit = channels.some((c) => c.type === 'audit');
  const hasKnowledge = channels.some((c) => c.type === 'knowledge');
  const maxPos = channels.reduce((m, c) => Math.max(m, c.position ?? 0), 0);

  const toInsert = [];
  if (!hasVoice) {
    toInsert.push({
      _id: new ObjectId(),
      serverId: srv._id,
      name: 'general-voice',
      topic: null,
      type: 'voice',
      defaultAgentId: null,
      position: maxPos + 1,
      createdAt: new Date(),
    });
  }
  if (!hasAudit) {
    toInsert.push({
      _id: new ObjectId(),
      serverId: srv._id,
      name: 'audit-log',
      topic: 'Owner-only audit log of agent activity',
      type: 'audit',
      defaultAgentId: null,
      position: 99,
      createdAt: new Date(),
    });
  }
  if (!hasKnowledge) {
    toInsert.push({
      _id: new ObjectId(),
      serverId: srv._id,
      name: 'knowledge-base',
      topic: 'Shared notes & docs — auto-fed into every agent on this server.',
      type: 'knowledge',
      defaultAgentId: null,
      position: Math.max(maxPos + 1, 3),
      createdAt: new Date(),
    });
  }
  if (toInsert.length) {
    await db.collection('channels').insertMany(toInsert);
    console.log(`  + ${srv.name}: added ${toInsert.map((c) => c.type).join(', ')}`);
    added += toInsert.length;
  } else {
    console.log(`  · ${srv.name}: ok`);
  }
}

console.log(`\ntotal channels added: ${added}`);
await c.close();
