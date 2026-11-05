// Sweep OG from every BonFire-owned private key into a single destination wallet.
//
// Sources scanned:
//   - .env files: DEPLOYER_PRIVATE_KEY, PLATFORM_EXECUTOR_PRIVATE_KEY,
//                 SEED_OWNER_PRIVATE_KEY, STORAGE_UPLOADER_PRIVATE_KEY
//   - Mongo `bonfire.servers.wallet.privateKey` (per-server inference wallets)
//
// Destination: passed as argv[2].
// Reserve: leaves ~0.0005 OG behind to cover gas of the sweep tx itself.
// Skips: wallets with balance < 2× gas reserve (dust).
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { ethers } from 'ethers';

const TO = process.argv[2];
if (!TO || !/^0x[a-fA-F0-9]{40}$/.test(TO)) {
  console.error('usage: tsx scripts/sweep-to-wallet.mjs <0x...>');
  process.exit(1);
}

const RPC = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
const MONGO = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
const DB = process.env.MONGODB_DB ?? 'bonfire';
const provider = new ethers.JsonRpcProvider(RPC);

// Tx parameters: standard EVM transfer (21000 gas) + headroom.
const GAS_LIMIT = 21_000n;

function norm(k) {
  if (!k) return null;
  const t = k.trim();
  return t.startsWith('0x') ? t : '0x' + t;
}

function addrFromKey(k) {
  try { return new ethers.Wallet(k).address; } catch { return null; }
}

// 1) Read .env files
const envPaths = [
  '/Users/silasashar/Documents/GitHub/bonfire/agent/.env',
  '/Users/silasashar/Documents/GitHub/bonfire/backend/.env',
  '/Users/silasashar/Documents/GitHub/bonfire/contracts/.env',
];
const envVars = [
  'DEPLOYER_PRIVATE_KEY',
  'PLATFORM_EXECUTOR_PRIVATE_KEY',
  'SEED_OWNER_PRIVATE_KEY',
  'STORAGE_UPLOADER_PRIVATE_KEY',
];
const found = new Map(); // address → { key, sources: [] }
for (const path of envPaths) {
  let content;
  try { content = readFileSync(path, 'utf8'); } catch { continue; }
  for (const v of envVars) {
    const m = content.match(new RegExp(`^${v}=(.+)$`, 'm'));
    if (!m) continue;
    const k = norm(m[1]);
    const a = addrFromKey(k);
    if (!a) continue;
    if (!found.has(a)) found.set(a, { key: k, sources: [] });
    found.get(a).sources.push(`${path}:${v}`);
  }
}

// 2) Read server wallets from Mongo
const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 3000 });
await c.connect();
const servers = await c.db(DB).collection('servers').find({ 'wallet.privateKey': { $exists: true } }).toArray();
await c.close();
for (const s of servers) {
  const k = norm(s.wallet?.privateKey);
  const a = addrFromKey(k);
  if (!a) continue;
  if (!found.has(a)) found.set(a, { key: k, sources: [] });
  found.get(a).sources.push(`server '${s.name}'`);
}

// 3) Print balance summary (skip destination — we never sweep ourselves into self)
console.log(`\n=== balance audit (target = ${TO}) ===`);
const live = [];
for (const [addr, info] of found) {
  if (addr.toLowerCase() === TO.toLowerCase()) {
    console.log(`  ${addr}  SKIP (this IS the target)`);
    continue;
  }
  const bal = await provider.getBalance(addr);
  console.log(`  ${addr}  bal=${ethers.formatEther(bal).padStart(12)} OG  sources=${info.sources.join(', ')}`);
  live.push({ addr, key: info.key, bal });
}
console.log(`total wallets enumerated: ${found.size} (sweeping ${live.length})`);

// 4) Sweep
console.log(`\n=== sweeping ===`);
let totalSwept = 0n;
let txCount = 0;
const feeData = await provider.getFeeData();
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 1_000_000_000n;
const gasCost = GAS_LIMIT * gasPrice;
const dustThreshold = gasCost * 3n;  // skip if balance ≤ 3× gas (not worth it)
console.log(`gasPrice ${ethers.formatUnits(gasPrice, 'gwei')} gwei → tx cost ~${ethers.formatEther(gasCost)} OG, dust < ${ethers.formatEther(dustThreshold)} OG`);

for (const { addr, key, bal } of live) {
  if (bal <= dustThreshold) {
    console.log(`  skip ${addr} (dust)`);
    continue;
  }
  const value = bal - gasCost;
  try {
    const wallet = new ethers.Wallet(key, provider);
    const tx = await wallet.sendTransaction({
      to: TO,
      value,
      gasLimit: GAS_LIMIT,
      gasPrice,
    });
    const receipt = await tx.wait();
    console.log(`  ✓ ${addr} → ${ethers.formatEther(value)} OG  tx=${tx.hash}  block=${receipt.blockNumber}`);
    totalSwept += value;
    txCount++;
  } catch (e) {
    console.log(`  ✗ ${addr} failed: ${e.message.slice(0, 150)}`);
  }
}

console.log(`\n=== result ===`);
console.log(`swept ${txCount} wallet(s) → total ${ethers.formatEther(totalSwept)} OG  → ${TO}`);
const finalBal = await provider.getBalance(TO);
console.log(`destination balance now: ${ethers.formatEther(finalBal)} OG`);
