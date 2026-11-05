// Reconstruct the bonfire.agents collection from on-chain INFT records.
//
// For each minted tokenId at the BonFireAgentINFT contract:
//   1. Read agents(tokenId) → manifestUri, bundleUri, sealedDEKBaseUri, bundleHash, mode, owner
//   2. Skip if manifestUri is mock:// (legacy blobs no longer fetchable)
//   3. Fetch the publicManifest blob from 0G storage → { slug, name, description, avatarUrl, tags }
//   4. Upsert AgentDoc into Mongo (keyed by tokenId)
//
// Idempotent: rerunning replaces nothing — `$setOnInsert` on tokenId, no clobber.
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { ethers } from 'ethers';
import { createOgStorage } from '../src/storage-0g/index.js';

const RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const CONTRACT = process.env.INFT_CONTRACT_ADDRESS;
const MONGO = process.env.MONGODB_URI;
const DB = process.env.MONGODB_DB ?? 'bonfire';
const AGENT_BASE_URL = process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777';

if (!CONTRACT) { console.error('INFT_CONTRACT_ADDRESS not set'); process.exit(1); }
if (!MONGO)    { console.error('MONGODB_URI not set'); process.exit(1); }

console.log('=== backfill agents from chain ===');
console.log('contract:', CONTRACT);
console.log('mongo:   ', MONGO.replace(/:\/\/[^@]+@/, '://***:***@'));
console.log('db:      ', DB);

const provider = new ethers.JsonRpcProvider(RPC);
const abi = [
  'function agents(uint256) view returns (address owner, bytes32 bundleHash, string manifestUri, string bundleUri, string sealedDEKBaseUri, uint8 mode, uint64 createdAt)',
  'function ownerOf(uint256) view returns (address)',
];
const contract = new ethers.Contract(CONTRACT, abi, provider);
const storage = createOgStorage();

const client = new MongoClient(MONGO);
await client.connect();
const db = client.db(DB);
const agentsCol = db.collection('agents');

// Probe how many tokens are minted (linear walk; the contract's _nextTokenId-1 is the max).
let maxToken = 0;
for (let i = 1; i <= 100; i++) {
  try {
    const r = await contract.agents(i);
    if (r.manifestUri && r.manifestUri.length > 0) maxToken = i;
    else if (maxToken > 0 && i > maxToken + 5) break;  // small gap, likely end
  } catch {}
}
console.log(`highest minted tokenId: ${maxToken}\n`);

let backfilled = 0, skippedMock = 0, skippedAlready = 0, failed = 0;

for (let tokenId = 1; tokenId <= maxToken; tokenId++) {
  let record;
  try { record = await contract.agents(tokenId); }
  catch (e) { console.log(`  tokenId ${tokenId}: read failed → ${e.message.slice(0,80)}`); failed++; continue; }

  const { owner, bundleHash, manifestUri, bundleUri, sealedDEKBaseUri, mode } = record;
  if (!manifestUri) { console.log(`  tokenId ${tokenId}: empty record (skip)`); continue; }

  // Existing?
  const existing = await agentsCol.findOne({ tokenId: tokenId.toString() });
  if (existing) {
    console.log(`  tokenId ${tokenId.toString().padStart(3)}  EXISTS  slug=${existing.slug}`);
    skippedAlready++;
    continue;
  }

  // Legacy mock URI — blob data is gone, can't reconstruct
  if (manifestUri.startsWith('mock://')) {
    console.log(`  tokenId ${tokenId.toString().padStart(3)}  SKIP-MOCK  uri=${manifestUri.slice(0, 40)}`);
    skippedMock++;
    continue;
  }

  // Fetch the public manifest from 0G storage
  let manifest;
  try {
    const buf = await storage.fetch(manifestUri);
    manifest = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    console.log(`  tokenId ${tokenId.toString().padStart(3)}  FETCH-FAIL  ${e.message.slice(0,80)}`);
    failed++;
    continue;
  }

  const doc = {
    _id: new ObjectId(),
    name: manifest.name ?? `agent-${tokenId}`,
    slug: manifest.slug ?? `token-${tokenId}`,
    avatarUrl: manifest.avatarUrl ?? null,
    description: manifest.description ?? '',
    bio: null,
    tags: manifest.tags ?? [],
    baseUrl: AGENT_BASE_URL,
    visibility: 'public',
    agentKeyHash: null,
    createdBy: null,
    createdAt: new Date(Number(record.createdAt) * 1000),
    updatedAt: new Date(),
    // chain pointers
    tokenId: tokenId.toString(),
    contractAddress: CONTRACT,
    ownerWallet: owner,
    mode: Number(mode) === 0 ? 'public' : 'permissioned',
    manifestUri,
    bundleUri,
    sealedDEKBaseUri,
    bundleHash,
  };

  try {
    await agentsCol.insertOne(doc);
    console.log(`  tokenId ${tokenId.toString().padStart(3)}  ✓ slug=${doc.slug.padEnd(15)} mode=${doc.mode}`);
    backfilled++;
  } catch (e) {
    if (e.code === 11000) {
      console.log(`  tokenId ${tokenId.toString().padStart(3)}  SKIP-SLUG-DUP  slug=${doc.slug}`);
      skippedAlready++;
    } else {
      console.log(`  tokenId ${tokenId.toString().padStart(3)}  INSERT-FAIL  ${e.message.slice(0,80)}`);
      failed++;
    }
  }
}

console.log(`\n=== summary ===`);
console.log(`  backfilled:    ${backfilled}`);
console.log(`  already in db: ${skippedAlready}`);
console.log(`  skipped (mock URI, blob gone): ${skippedMock}`);
console.log(`  failed:        ${failed}`);
console.log(`  total agents in db now: ${await agentsCol.countDocuments()}`);
await client.close();
