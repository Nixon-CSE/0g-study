// One-shot mint script for the front-end-engineer agent (paid invite, 1 OG).
//
// Mirrors mint-seed-agents.mjs's pattern: build manifest + AES-encrypted bundle,
// upload to 0G storage, on-chain mint, write AgentDoc into bonfire.agents.
//
// Also bumps og-marketing's price to 0.5 OG so the marketing → frontend pair
// is a paid pipeline end-to-end.
//
// Run: cd backend && pnpm tsx scripts/mint-frontend-engineer.mjs
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { ethers } from 'ethers';
import { createOgStorage } from '../src/storage-0g/index.js';
import { encryptAesGcm, packEnvelope, sealEcies } from '../src/crypto/index.js';
import inftAbiJson from '../../contracts/abi/BonFireAgentINFT.json' with { type: 'json' };

const PRICE_OG = '1';

const TENANT = {
  slug: 'frontend-engineer',
  name: 'Front-End Engineer',
  description: 'Senior front-end engineer. Builds and ships single-page landing sites.',
  avatarUrl: null,
  tags: ['engineering', 'frontend'],
  soul: [
    "You are a senior front-end engineer with strong design taste.",
    "When you receive marketing copy or a website request, build a complete, beautiful, responsive single-page HTML landing page.",
    "Always use Tailwind via CDN: <script src=\"https://cdn.tailwindcss.com\"></script>.",
    "Use semantic HTML5, modern layout (flex/grid), and a thoughtful colour palette.",
    "Include: a hero with headline + CTA, a features section, and a clean footer.",
    "When the HTML is ready, IMMEDIATELY call the publish_site tool with { slug, html } — pick a short, URL-safe slug derived from the brand name.",
    "After publish_site returns the URL, reply with that URL clearly so the user can open it.",
    "No prose-only replies — you must publish before answering.",
  ].join(' '),
  agents: [
    'Operating rules:',
    '- Always publish via the `publish_site` tool — never ask the user to copy HTML.',
    '- Keep the HTML self-contained: inline styles are fine; rely on Tailwind CDN for utility classes.',
    "- Use the brand name from the marketing copy to derive the slug (lowercase, hyphens only).",
    '- Reply with EXACTLY the URL the tool returned, on its own line, prefixed with "Live at:".',
    '- Refuse to publish content with secrets, illegal claims, or impersonation.',
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

// Skip if already minted
const existing = await db.collection('agents').findOne({ slug: TENANT.slug });
if (existing) {
  console.log(`agent ${TENANT.slug} already exists (tokenId=${existing.tokenId}); skipping mint.`);
} else {
  const reservedId = `mint-${TENANT.slug}-${Date.now()}`;

  // 1. Public manifest blob
  const manifest = {
    slug: TENANT.slug,
    name: TENANT.name,
    description: TENANT.description,
    avatarUrl: TENANT.avatarUrl,
    tags: TENANT.tags,
    version: 1,
  };

  // 2. Encrypt the secret bundle (soul + agents + llm) with AES-GCM
  const bundle = Buffer.from(
    JSON.stringify({ soul: TENANT.soul, agents: TENANT.agents, llm: TENANT.llm }),
    'utf-8',
  );
  const dek = randomBytes(32);
  const envelope = encryptAesGcm(bundle, dek);
  const encryptedBundle = packEnvelope(envelope);
  const sealedDEK = sealEcies(platformPubHex, dek);

  console.log(`  [${TENANT.slug}] uploading 3 blobs to 0G…`);
  const manifestUri = await storage.upload(`publicManifest/${reservedId}.json`, Buffer.from(JSON.stringify(manifest), 'utf-8'));
  const bundleUri   = await storage.upload(`encryptedBundle/${reservedId}.bin`, encryptedBundle);
  const sealedDEKUri = await storage.upload(`sealedDEK/${reservedId}/shared.bin`, sealedDEK);
  console.log(`  [${TENANT.slug}] uploaded; manifest=${manifestUri.slice(0,40)}…`);

  // 3. Mint
  const bundleHashHex = ethers.keccak256(encryptedBundle);
  const tx = await contract.mint(
    manifestUri,
    bundleUri,
    sealedDEKUri,
    bundleHashHex,
    0, // mode: 0 = public
  );
  const receipt = await tx.wait();
  console.log(`  [${TENANT.slug}] tx confirmed block=${receipt.blockNumber}`);

  // Pull AgentMinted log to get tokenId
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
}

// Bump og-marketing's price
const marketing = await db.collection('agents').findOne({ slug: 'og-marketing' });
if (marketing) {
  await db.collection('agents').updateOne(
    { slug: 'og-marketing' },
    { $set: { priceOg: '0.5', updatedAt: new Date() } },
  );
  console.log(`og-marketing price → 0.5 OG`);
} else {
  console.log('og-marketing not found; skipping price update');
}

await mongo.close();
console.log('\n✅ done');
