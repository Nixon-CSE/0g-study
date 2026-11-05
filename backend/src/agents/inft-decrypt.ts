import { ethers } from 'ethers';
import { LRUCache } from 'lru-cache';
import type { OgStorageClient } from '../storage-0g/index.js';
import { unsealEcies, decryptAesGcm, unpackEnvelope } from '../crypto/index.js';
import type { AgentDoc } from '../db/types.js';

export interface DecryptedBundle {
  soul: string;
  agents: string;
  llm: {
    provider?: 'openai-compatible' | 'zerog';
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    apiKeyEnv?: string;
  };
}

// Bundles are immutable in v1 (no transfers, no re-mint), so cache lives for the process lifetime.
const cache = new LRUCache<string, DecryptedBundle>({ max: 1000 });

export async function decryptAgentBundle(opts: {
  agent: AgentDoc;
  storage: OgStorageClient;
  platformExecutorPrivkey: string;
}): Promise<DecryptedBundle> {
  const { agent, storage, platformExecutorPrivkey } = opts;

  if (!agent.bundleUri || !agent.sealedDEKBaseUri || !agent.bundleHash) {
    throw new Error(`agent ${agent.slug} is not INFT-backed (missing chain refs)`);
  }

  const cacheKey = agent.bundleHash.toLowerCase();
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  // sealedDEKBaseUri historically tried to be a directory URI with `/shared.bin`
  // appended at fetch time, but real-world URI schemes (incl. our mock) don't
  // preserve path structure cleanly. v1 stores the sealed-DEK file URI directly.
  const [encryptedBundle, sealedDEK] = await Promise.all([
    storage.fetch(agent.bundleUri),
    storage.fetch(agent.sealedDEKBaseUri),
  ]);

  const expectedRaw = agent.bundleHash.toLowerCase();
  const expected = expectedRaw.startsWith('0x') ? expectedRaw : `0x${expectedRaw}`;
  if (ethers.keccak256(encryptedBundle).toLowerCase() !== expected) {
    throw new Error(`bundleHash mismatch for agent ${agent.slug}`);
  }

  const dek = unsealEcies(platformExecutorPrivkey, sealedDEK);
  const envelope = unpackEnvelope(encryptedBundle);
  const bundle = JSON.parse(decryptAesGcm(envelope, dek).toString('utf-8')) as DecryptedBundle;

  cache.set(cacheKey, bundle);
  return bundle;
}

/** Test-only — clear the in-memory bundle cache to prevent cross-test pollution. */
export function clearBundleCache(): void {
  cache.clear();
}
