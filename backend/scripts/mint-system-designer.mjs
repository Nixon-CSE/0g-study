// Mint the system-designer agent (paid invite, 0.75 OG).
// Same pattern as mint-frontend-engineer.mjs.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { ethers } from 'ethers';
import { createOgStorage } from '../src/storage-0g/index.js';
import { encryptAesGcm, packEnvelope, sealEcies } from '../src/crypto/index.js';
import inftAbiJson from '../../contracts/abi/BonFireAgentINFT.json' with { type: 'json' };

const PRICE_OG = '0.75';

const TENANT = {
  slug: 'system-designer',
  name: 'System Designer',
  description: 'Senior software architect. Designs the system before a single line is written.',
  avatarUrl: null,
  tags: ['engineering', 'architecture'],
  soul: [
    "You are a senior software / system architect with 15 years of experience shipping production systems.",
    "When you receive a product request or feature spec, produce a clean architecture document.",
    "Structure every reply with these sections, in this order:",
    "  1. **Goal** — one sentence restating what we're building.",
    "  2. **Stack** — bullet list of services, languages, and key libraries with one-line justifications.",
    "  3. **Data model** — the 3-7 most important entities + their key fields.",
    "  4. **API surface** — the 5-10 most important endpoints with method+path+one-line purpose.",
    "  5. **Trade-offs** — 2-3 explicit calls (e.g. 'SQLite vs Mongo: chose Mongo because…').",
    "  6. **Next step** — one short paragraph describing the UI we'd need.",
    "Keep designs concrete, opinionated, and shippable in one sprint.",
    "If a UI would be useful for the user to see this design, end your reply with a literal '@frontend-engineer build a landing page for: <one-line product pitch>' on its own line, so the front-end-engineer can render a marketing site.",
    "Otherwise, end without inviting anyone.",
  ].join(' '),
  agents: [
    'Operating rules:',
    '- Always include the 6 sections in order; if a section is genuinely N/A, write "N/A — <one-line reason>".',
    '- Be opinionated. Pick a stack, defend it.',
    '- No "it depends" without a concrete recommendation that follows.',
    '- Refuse to design systems with illegal, deceptive, or harmful intent.',
    '- Only invite @frontend-engineer when the user explicitly asked for a UI/website or the product clearly needs one.',
    '- Never invite the same peer twice in one cascade.',
  ].join('\n'),
  llm: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`missing ${name}`); process.exit(1); }
  return v;
}

const rpcUrl = requireEnv('OG_RPC_URL');
const contractAddress = requireEnv('INFT_CONTRACT_ADDRESS');
const seedKey = requireEnv('SEED_OWNER_PRIVATE_KEY');
const platformPubHex = (() => {
  const k = requireEnv('PLATFORM_EXECUTOR_PRIVATE_KEY');
  return new ethers.Wallet(k).signingKey.publicKey;
})();
const mongoUrl = requireEnv('MONGODB_URI');
const dbName = process.env.MONGODB_DB ?? 'bonfire';

const provider = new ethers.JsonRpcProvider(rpcUrl);
const seedWallet = new ethers.Wallet(seedKey, provider);
const abi = inftAbiJson.abi ?? inftAbiJson;
const contract = new ethers.Contract(contractAddress, abi, seedWallet);
const storage = createOgStorage();

const mongo = new MongoClient(mongoUrl);
await mongo.connect();
const db = mongo.db(dbName);

console.log('seed wallet:', seedWallet.address);
console.log('contract:   ', contractAddress);
console.log('mongo:      ', mongoUrl.replace(/:\/\/[^@]+@/, '://***:***@'));
console.log('');

const existing = await db.collection('agents').findOne({ slug: TENANT.slug });
if (existing) {
  console.log(`agent ${TENANT.slug} already exists (tokenId=${existing.tokenId}); skipping mint.`);
  await mongo.close();
  process.exit(0);
}

const reservedId = `mint-${TENANT.slug}-${Date.now()}`;

const manifest = {
  slug: TENANT.slug,
  name: TENANT.name,
  description: TENANT.description,
  avatarUrl: TENANT.avatarUrl,
  tags: TENANT.tags,
  version: 1,
};

const bundleBuf = Buffer.from(
  JSON.stringify({ soul: TENANT.soul, agents: TENANT.agents, llm: TENANT.llm }),
  'utf-8',
);
const dek = randomBytes(32);
const envelope = encryptAesGcm(bundleBuf, dek);
const encryptedBundle = packEnvelope(envelope);
const sealedDEK = sealEcies(platformPubHex, dek);

console.log(`  [${TENANT.slug}] uploading 3 blobs to 0G…`);
const manifestUri = await storage.upload(`publicManifest/${reservedId}.json`, Buffer.from(JSON.stringify(manifest), 'utf-8'));
const bundleUri   = await storage.upload(`encryptedBundle/${reservedId}.bin`, encryptedBundle);
const sealedDEKUri = await storage.upload(`sealedDEK/${reservedId}/shared.bin`, sealedDEK);
console.log(`  [${TENANT.slug}] uploaded`);

const bundleHashHex = ethers.keccak256(encryptedBundle);
const tx = await contract.mint(
  manifestUri,
  bundleUri,
  sealedDEKUri,
  bundleHashHex,
  0, // mode: public
);
const receipt = await tx.wait();
console.log(`  [${TENANT.slug}] tx confirmed block=${receipt.blockNumber}`);

const iface = new ethers.Interface(abi);
let tokenId = null;
for (const lg of receipt.logs) {
  try {
    const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
    if (parsed?.name === 'AgentMinted') {
      tokenId = parsed.args[0].toString();
      break;
    }
  } catch {}
}
if (!tokenId) { console.error('could not parse AgentMinted log'); process.exit(1); }

await db.collection('agents').insertOne({
  _id: new ObjectId(),
  name: TENANT.name,
  slug: TENANT.slug,
  avatarUrl: TENANT.avatarUrl,
  description: TENANT.description,
  bio: null,
  tags: TENANT.tags,
  baseUrl: process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777',
  visibility: 'public',
  agentKeyHash: null,
  createdBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tokenId,
  contractAddress,
  ownerWallet: seedWallet.address,
  manifestUri,
  bundleUri,
  sealedDEKBaseUri: sealedDEKUri,
  bundleHash: bundleHashHex,
  priceOg: PRICE_OG,
});
console.log(`  [${TENANT.slug}] AgentDoc written; tokenId=${tokenId} priceOg=${PRICE_OG}`);

await mongo.close();
console.log('\n✅ done');
