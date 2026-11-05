#!/usr/bin/env node
/**
 * mint-seed-agents.mjs
 *
 * One-shot migration: reads agent/data/tenants.json, builds encrypted bundles for
 * each of the 8 seed personalities, uploads to 0G Storage, mints each as a
 * BonFireAgentINFT on-chain, and inserts an AgentDoc into Mongo.
 *
 * Idempotent — slugs that already have a tokenId in the agents collection are
 * skipped, so the script is safe to re-run after a partial failure.
 *
 * On full success the source file is renamed to tenants.json.legacy so the
 * legacy /chat UI can still find it while the migration remains auditable.
 *
 * Required env vars:
 *   SEED_OWNER_PRIVATE_KEY         wallet that will own all seed agents (~5 OG funded)
 *   PLATFORM_EXECUTOR_PRIVATE_KEY  platform executor; pubkey is used to seal each DEK
 *   INFT_CONTRACT_ADDRESS          deployed BonFireAgentINFT address
 *   MONGO_URL                      backend MongoDB connection string
 *
 * Optional env vars:
 *   OG_RPC_URL        defaults to https://evmrpc-testnet.0g.ai
 *   OG_STORAGE_MOCK   set to 1 to use the filesystem mock (dry-run / CI)
 *   EMBER_AGENT_BASE_URL  baseUrl written into AgentDoc (default http://localhost:7777)
 *
 * Usage (from backend/):
 *   pnpm tsx scripts/mint-seed-agents.mjs
 */

import { readFile, rename, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import { MongoClient } from 'mongodb';

// TypeScript source modules — resolved via tsx / ts-node at runtime.
// The .js extensions are required by Node's NodeNext resolver even for .ts files.
import { encryptAesGcm, packEnvelope, sealEcies, pubkeyFromPrivkey } from '../src/crypto/index.js';
import { createOgStorage } from '../src/storage-0g/index.js';
import { collections } from '../src/db/types.js';

// Contract ABI — static JSON; import assertion keeps bundlers happy.
import inftAbiJson from '../../contracts/abi/BonFireAgentINFT.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read a required environment variable, exit with a clear error if absent.
 *
 * @param {string} name - environment variable name
 * @returns {string} the value
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[mint-seed-agents] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // ── Env ──────────────────────────────────────────────────────────────────
  const seedPriv = requireEnv('SEED_OWNER_PRIVATE_KEY');
  const platformPriv = requireEnv('PLATFORM_EXECUTOR_PRIVATE_KEY');
  const contractAddress = requireEnv('INFT_CONTRACT_ADDRESS');
  const mongoUrl = requireEnv('MONGO_URL');
  const rpcUrl = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const agentBaseUrl = process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777';

  // ── Source file ──────────────────────────────────────────────────────────
  const tenantsPath = resolve(__dirname, '../../agent/data/tenants.json');
  const tenantsLegacyPath = tenantsPath + '.legacy';

  try {
    await access(tenantsPath);
  } catch {
    // If the file is gone the migration already completed successfully.
    console.log('[mint-seed-agents] tenants.json not found — migration already complete.');
    process.exit(0);
  }

  const tenants = JSON.parse(await readFile(tenantsPath, 'utf-8'));
  console.log(`[mint-seed-agents] Found ${tenants.length} seed tenants in tenants.json`);

  // ── Clients ───────────────────────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const seedWallet = new ethers.Wallet(seedPriv, provider);
  console.log(`[mint-seed-agents] Seed wallet: ${seedWallet.address}`);

  // pubkeyFromPrivkey returns a 65-byte uncompressed hex string (no 0x prefix).
  // sealEcies accepts both compressed (33-byte) and uncompressed (65-byte) hex.
  const platformPubHex = pubkeyFromPrivkey(platformPriv);

  // BonFireAgentINFT ABI may be wrapped as { abi: [...] } or be the array directly.
  const abi = inftAbiJson.abi ?? inftAbiJson;
  const contract = new ethers.Contract(contractAddress, abi, seedWallet);

  const storage = createOgStorage();

  const mongo = new MongoClient(mongoUrl);
  await mongo.connect();
  // Use MONGODB_DB if the URI doesn't carry a default db name (backend convention).
  const dbName = process.env.MONGODB_DB ?? undefined;
  const db = dbName ? mongo.db(dbName) : mongo.db();
  const agentsCol = db.collection(collections.agents);

  // ── Per-tenant loop ───────────────────────────────────────────────────────
  let minted = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of tenants) {
    const label = `[${t.slug}]`;

    // Idempotency check — slug already present with a tokenId means it was minted.
    const existing = await agentsCol.findOne({ slug: t.slug, tokenId: { $exists: true } });
    if (existing) {
      console.log(`  ${label} already minted (tokenId=${existing.tokenId}) — skipping`);
      skipped++;
      continue;
    }

    console.log(`  ${label} building bundle…`);

    try {
      // ── 1. Compose manifest (public) and bundle (secret) ──────────────────
      const manifest = {
        slug: t.slug,
        name: t.name,
        description: t.description,
        avatarUrl: t.avatarUrl ?? null,
        tags: t.tags ?? [],
        version: 1,
      };

      // The secret bundle: soul + agents + llm config.
      // env is intentionally excluded — it contains per-server runtime secrets.
      const bundle = JSON.stringify({
        soul: t.soul,
        agents: t.agents,
        llm: t.llm ?? {},
      });

      // ── 2. Encrypt bundle ─────────────────────────────────────────────────
      const dek = randomBytes(32);

      // encryptAesGcm returns an AesGcmEnvelope; packEnvelope serialises it to
      // the [iv(12) | tag(16) | ciphertext] wire format expected by the backend.
      const envelope = encryptAesGcm(Buffer.from(bundle, 'utf-8'), dek);
      const encryptedBundle = packEnvelope(envelope);

      // Seal the DEK for the platform executor using ECIES.
      // sealEcies accepts a hex pubkey string and a Buffer plaintext.
      const sealedDEK = sealEcies(platformPubHex, dek);

      // bundleHash is stored on-chain for integrity verification on decrypt.
      const bundleHash = ethers.keccak256(encryptedBundle);

      // ── 3. Upload to 0G Storage in parallel ───────────────────────────────
      // Key format mirrors the spec's 0G Storage layout section.
      // We use a temporary slug-keyed path before tokenId is known;
      // the on-chain AgentRecord points to these URIs permanently.
      const reservedId = `seed-${t.slug}-${Date.now()}`;

      console.log(`  ${label} uploading to 0G Storage…`);
      // Sequential uploads — parallel collides on the uploader wallet's tx nonce
      // ("replacement transaction underpriced") since each blob requires a Flow contract submission.
      const manifestUri = await storage.upload(`publicManifest/${reservedId}.json`, Buffer.from(JSON.stringify(manifest), 'utf-8'));
      const bundleUri = await storage.upload(`encryptedBundle/${reservedId}.bin`, encryptedBundle);
      const sealedDEKUri = await storage.upload(`sealedDEK/${reservedId}/shared.bin`, sealedDEK);

      // sealedDEKBaseUri stores the sealed-DEK URI directly; decrypt fetches it as-is.
      const sealedDEKBaseUri = sealedDEKUri;

      // ── 4. Mint on-chain ──────────────────────────────────────────────────
      console.log(`  ${label} sending mint tx…`);
      const tx = await contract.mint(
        manifestUri,
        bundleUri,
        sealedDEKBaseUri,
        bundleHash,
        0, // mode: 0 = public (all seed agents are public)
      );
      const receipt = await tx.wait();
      console.log(`  ${label} tx confirmed (block ${receipt.blockNumber})`);

      // ── 5. Parse AgentMinted event to extract tokenId ─────────────────────
      let tokenId = null;
      for (const log of receipt.logs ?? []) {
        try {
          const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
          if (parsed?.name === 'AgentMinted') {
            // First arg of AgentMinted is the tokenId (uint256)
            tokenId = parsed.args[0];
            break;
          }
        } catch {
          // Log belongs to a different contract or event; skip silently.
        }
      }

      if (tokenId == null) {
        console.error(`  ${label} ERROR: AgentMinted event not found in receipt — skipping AgentDoc insert`);
        failed++;
        continue;
      }

      // ── 6. Insert AgentDoc into Mongo ─────────────────────────────────────
      await agentsCol.insertOne({
        slug: t.slug,
        name: t.name,
        avatarUrl: t.avatarUrl ?? null,
        description: t.description,
        bio: null,
        tags: t.tags ?? [],
        baseUrl: agentBaseUrl,
        visibility: 'public',
        agentKeyHash: null,
        // Seed agents are not owned by any platform user — createdBy is null.
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        // INFT fields
        tokenId: tokenId.toString(), // bigint → string (Mongo cannot hold full uint256)
        contractAddress,
        ownerWallet: seedWallet.address,
        mode: 'public',
        manifestUri,
        bundleUri,
        sealedDEKBaseUri,
        bundleHash,
      });

      console.log(`  ${label} minted successfully (tokenId=${tokenId.toString()})`);
      minted++;
    } catch (err) {
      console.error(`  ${label} ERROR:`, err);
      failed++;
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  await mongo.close();

  console.log(`\n[mint-seed-agents] Results: minted=${minted}, skipped=${skipped}, failed=${failed}, total=${tenants.length}`);

  // Only rename tenants.json once every tenant has been either minted or was
  // already minted (skipped). If any failed, leave the file in place so a
  // re-run can retry the failures.
  const successCount = minted + skipped;
  if (successCount === tenants.length && failed === 0) {
    await rename(tenantsPath, tenantsLegacyPath);
    console.log(`[mint-seed-agents] Renamed tenants.json → tenants.json.legacy`);
    console.log('[mint-seed-agents] Migration complete.');
  } else {
    console.warn(
      `[mint-seed-agents] Partial completion — tenants.json left in place. Re-run to retry ${failed} failed tenant(s).`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[mint-seed-agents] Fatal error:', err);
  process.exit(1);
});
