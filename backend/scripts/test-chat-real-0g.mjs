// End-to-end test: real 0G storage → decrypt → invoke ember-agent → assert reply.
// Mirrors what `runInvocationLinked` does in invoker.ts, minus the cascade plumbing.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { createOgStorage } from '../src/storage-0g/index.js';
import { decryptAgentBundle } from '../src/agents/inft-decrypt.js';
import { invokeAgent } from '../src/agents/client.js';
import { createInftChain } from '../src/chain/inft.js';

const mongo = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://localhost:27017');
await mongo.connect();
const db = mongo.db(process.env.MONGODB_DB ?? 'bonfire');
const ember = await db.collection('agents').findOne({ slug: 'ember' });
if (!ember) { console.log('no ember'); process.exit(1); }

console.log('agent:', ember.slug, 'tokenId:', ember.tokenId);

const inft = createInftChain();
const storage = createOgStorage();

// 1. Authorization check (public)
const isAuth = await inft.isAuthorized(BigInt(ember.tokenId), '0x0000000000000000000000000000000000000001');
console.log('isAuthorized:', isAuth);
if (!isAuth) { console.log('FAIL: not authorized'); process.exit(1); }

// 2. Decrypt bundle from real 0G storage
console.log('decrypting bundle from 0G...');
const bundle = await decryptAgentBundle({
  agent: ember,
  storage,
  platformExecutorPrivkey: process.env.PLATFORM_EXECUTOR_PRIVATE_KEY,
});
console.log('soul preview:', bundle.soul.slice(0, 80));

// 3. Use a server's wallet for envOverride (need OG ledger for 0G inference)
const server = await db.collection('servers').findOne({ 'wallet.address': { $exists: true } });
if (!server?.wallet?.privateKey) { console.log('no server wallet found'); process.exit(1); }
console.log('using server wallet:', server.wallet.address);

// 4. Invoke the agent with the decrypted inline tenant
console.log('invoking ember-agent...');
const reply = await invokeAgent({
  baseUrl: ember.baseUrl,
  chatId: `e2e-test-${Date.now()}`,
  text: 'In one short sentence: name your favorite color and why.',
  tenantInline: {
    slug: ember.slug,
    name: ember.name,
    soul: bundle.soul,
    agents: bundle.agents,
    llm: bundle.llm,
  },
  envOverride: { DEPLOYER_PRIVATE_KEY: server.wallet.privateKey },
});

console.log('=== EMBER REPLY ===');
console.log(reply);
await mongo.close();
if (!reply || reply.trim().length === 0) {
  console.log('FAIL: empty reply');
  process.exit(1);
}
console.log('\n✅ FULL CHAT FLOW VIA REAL 0G STORAGE PASSED');
