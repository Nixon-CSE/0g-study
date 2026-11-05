/**
 * Tests for backend/src/agents/inft-decrypt.ts
 *
 * Covers:
 *  - Happy path: encrypt a known bundle, store in mock storage, decrypt → original
 *  - Tampered bundle: bit-flip in stored bytes → bundleHash mismatch error
 *  - Missing chain refs (no bundleUri/sealedDEKBaseUri/bundleHash) → "not INFT-backed"
 *  - LRU cache: second call skips storage fetch entirely
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import {
  encryptAesGcm,
  packEnvelope,
  sealEcies,
  pubkeyFromPrivkey,
} from '../src/crypto/index.js';
import { decryptAgentBundle, clearBundleCache } from '../src/agents/inft-decrypt.js';
import type { OgStorageClient } from '../src/storage-0g/index.js';
import type { AgentDoc } from '../src/db/types.js';
import { ObjectId } from 'mongodb';

// ---------------------------------------------------------------------------
// Test fixture keypair (Hardhat account #1)
// ---------------------------------------------------------------------------
const PLATFORM_PRIV = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const PLATFORM_PUB = pubkeyFromPrivkey(PLATFORM_PRIV);

// ---------------------------------------------------------------------------
// In-memory mock OgStorageClient
//
// Uses a plain Map keyed by URI; upload returns the key used for `storage.fetch(agent.*Uri)`.
// ---------------------------------------------------------------------------
function makeInMemoryStorage(): OgStorageClient & { _store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    _store: store,
    async upload(key: string, data: Buffer): Promise<string> {
      store.set(key, data);
      return key; // URI == key for simplicity
    },
    async fetch(uri: string): Promise<Buffer> {
      const data = store.get(uri);
      if (!data) throw new Error(`InMemoryStorage: no entry for URI "${uri}"`);
      return data;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface UploadResult {
  storage: OgStorageClient & { _store: Map<string, Buffer> };
  bundleUri: string;
  sealedDEKBaseUri: string;
  bundleHash: string;
  dek: Buffer;
  encryptedBundle: Buffer;
}

/** Build and upload a real encrypted bundle + sealedDEK to in-memory storage. */
async function buildAndUpload(
  bundle: Record<string, unknown>,
  tamperBundle = false,
): Promise<UploadResult> {
  const storage = makeInMemoryStorage();
  const dek = randomBytes(32);
  const plaintext = Buffer.from(JSON.stringify(bundle), 'utf-8');
  const envelope = encryptAesGcm(plaintext, dek);
  let encryptedBundle = packEnvelope(envelope);

  // Hash BEFORE tamper so AgentDoc carries the good hash
  const bundleHash = ethers.keccak256(encryptedBundle).toLowerCase();

  if (tamperBundle) {
    const t = Buffer.from(encryptedBundle);
    // Flip a byte in the ciphertext region (after iv[12] + tag[16] = offset 28)
    t[28] ^= 0xff;
    encryptedBundle = t;
  }

  const sealedDEK = sealEcies(PLATFORM_PUB, dek);

  const bundleUri = await storage.upload('encryptedBundle/1.bin', encryptedBundle);
  const sealedDEKBaseUri = await storage.upload('sealedDEK/1.bin', sealedDEK);

  return { storage, bundleUri, sealedDEKBaseUri, bundleHash, dek, encryptedBundle };
}

function makeAgentDoc(overrides: Partial<AgentDoc> = {}): AgentDoc {
  return {
    _id: new ObjectId(),
    name: 'Test Agent',
    slug: 'test-agent',
    avatarUrl: null,
    description: 'test',
    bio: null,
    tags: [],
    baseUrl: 'http://localhost:7777',
    visibility: 'public',
    agentKeyHash: null,
    createdBy: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    tokenId: '1',
    contractAddress: '0x1234',
    ownerWallet: '0xabcd',
    ...overrides,
  } as AgentDoc;
}

const BUNDLE_FIXTURE = {
  soul: 'You are a helpful assistant.',
  agents: 'AGENTS.md content here.',
  llm: {
    provider: 'openai-compatible' as const,
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearBundleCache();
  vi.clearAllMocks();
});

describe('decryptAgentBundle', () => {
  it('happy path: returns the original bundle after encrypt → upload → decrypt', async () => {
    const { storage, bundleUri, sealedDEKBaseUri, bundleHash } =
      await buildAndUpload(BUNDLE_FIXTURE);

    const agent = makeAgentDoc({ bundleUri, sealedDEKBaseUri, bundleHash });

    const result = await decryptAgentBundle({
      agent,
      storage,
      platformExecutorPrivkey: PLATFORM_PRIV,
    });

    expect(result.soul).toBe(BUNDLE_FIXTURE.soul);
    expect(result.agents).toBe(BUNDLE_FIXTURE.agents);
    expect(result.llm.model).toBe(BUNDLE_FIXTURE.llm.model);
    expect(result.llm.provider).toBe(BUNDLE_FIXTURE.llm.provider);
  });

  it('tampered bundle: bit-flip in stored bytes → bundleHash mismatch error', async () => {
    // tamperBundle=true stores tampered bytes but AgentDoc carries the pre-tamper hash
    const { storage, bundleUri, sealedDEKBaseUri, bundleHash } =
      await buildAndUpload(BUNDLE_FIXTURE, true);

    const agent = makeAgentDoc({ bundleUri, sealedDEKBaseUri, bundleHash });

    await expect(
      decryptAgentBundle({ agent, storage, platformExecutorPrivkey: PLATFORM_PRIV }),
    ).rejects.toThrow('bundleHash mismatch');
  });

  it('missing chain refs (no bundleUri) → throws "not INFT-backed"', async () => {
    const storage = makeInMemoryStorage();
    const agent = makeAgentDoc({
      tokenId: '1',
      bundleUri: undefined,
      sealedDEKBaseUri: undefined,
      bundleHash: undefined,
    });

    await expect(
      decryptAgentBundle({ agent, storage, platformExecutorPrivkey: PLATFORM_PRIV }),
    ).rejects.toThrow('not INFT-backed');
  });

  it('missing bundleHash only → throws "not INFT-backed"', async () => {
    const storage = makeInMemoryStorage();
    const agent = makeAgentDoc({
      bundleUri: 'encryptedBundle/1.bin',
      sealedDEKBaseUri: 'sealedDEK/1',
      bundleHash: undefined,
    });

    await expect(
      decryptAgentBundle({ agent, storage, platformExecutorPrivkey: PLATFORM_PRIV }),
    ).rejects.toThrow('not INFT-backed');
  });

  it('second call hits LRU cache — storage.fetch not called again', async () => {
    const { storage, bundleUri, sealedDEKBaseUri, bundleHash } =
      await buildAndUpload(BUNDLE_FIXTURE);

    const agent = makeAgentDoc({ bundleUri, sealedDEKBaseUri, bundleHash });

    // First call — populates the LRU cache (internally calls storage.fetch twice)
    const first = await decryptAgentBundle({
      agent,
      storage,
      platformExecutorPrivkey: PLATFORM_PRIV,
    });

    // Spy AFTER the first call to measure only the second call
    const fetchSpy = vi.spyOn(storage, 'fetch');

    // Second call — should return from cache with no storage reads
    const second = await decryptAgentBundle({
      agent,
      storage,
      platformExecutorPrivkey: PLATFORM_PRIV,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(second.soul).toBe(first.soul);
    expect(second.agents).toBe(first.agents);
  });

  it('bundleHash with 0x prefix is accepted', async () => {
    const { storage, bundleUri, sealedDEKBaseUri, bundleHash } =
      await buildAndUpload(BUNDLE_FIXTURE);

    // Provide bundleHash with 0x prefix (as ethers.keccak256 returns it)
    const agentWith0x = makeAgentDoc({ bundleUri, sealedDEKBaseUri, bundleHash });
    const agentWithout0x = makeAgentDoc({
      bundleUri,
      sealedDEKBaseUri,
      bundleHash: bundleHash.startsWith('0x') ? bundleHash.slice(2) : bundleHash,
    });

    clearBundleCache();
    const r1 = await decryptAgentBundle({
      agent: agentWith0x,
      storage,
      platformExecutorPrivkey: PLATFORM_PRIV,
    });

    clearBundleCache();
    const r2 = await decryptAgentBundle({
      agent: agentWithout0x,
      storage,
      platformExecutorPrivkey: PLATFORM_PRIV,
    });

    expect(r1.soul).toBe(r2.soul);
  });
});
