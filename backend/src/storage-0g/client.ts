/**
 * 0G Storage client abstraction.
 *
 * Mock mode (OG_STORAGE_MOCK=1): writes/reads from backend/.storage-mock/<sha256-of-key>.bin.
 * Real mode: uses @0gfoundation/0g-ts-sdk (1.2.x). URIs are `og://<rootHash>` where
 * rootHash is the 0x-prefixed bytes32 merkle root returned by the storage layer.
 */

import { createHash } from 'node:crypto';
import { log } from '../util/logger.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface OgStorageClient {
  /**
   * Upload binary data under a logical key.
   *
   * @param key - Logical storage key (e.g. "publicManifest/42.json")
   * @param data - Raw bytes to store
   * @returns URI that can be passed to fetch() to retrieve the same bytes
   */
  upload(key: string, data: Buffer): Promise<string>;

  /**
   * Fetch binary data by URI returned from a previous upload() call.
   *
   * @param uri - URI returned by upload()
   * @returns Raw bytes as a Buffer
   * @throws Error if the URI does not resolve to stored data
   */
  fetch(uri: string): Promise<Buffer>;
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

function keyToFilename(key: string): string {
  return createHash('sha256').update(key).digest('hex') + '.bin';
}

function mockDir(): string {
  // src/storage-0g/client.ts -> up two levels -> backend/
  const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  return join(backendRoot, '.storage-mock');
}

function createMockStorage(): OgStorageClient {
  return {
    async upload(key: string, data: Buffer): Promise<string> {
      const dir = mockDir();
      await mkdir(dir, { recursive: true });
      const filename = keyToFilename(key);
      await writeFile(join(dir, filename), data);
      // URI preserves the key so callers can build path-like sub-URIs
      // (e.g. baseUri + '/shared.bin') and have them resolve correctly.
      return `mock://${encodeURIComponent(key)}`;
    },

    async fetch(uri: string): Promise<Buffer> {
      if (!uri.startsWith('mock://')) {
        throw new Error(`Mock storage cannot resolve non-mock URI: ${uri}`);
      }
      const key = decodeURIComponent(uri.slice('mock://'.length));
      const dir = mockDir();
      const filePath = join(dir, keyToFilename(key));
      if (!existsSync(filePath)) {
        throw new Error(`Mock storage: no entry for URI ${uri}`);
      }
      return readFile(filePath);
    },
  };
}

// ---------------------------------------------------------------------------
// Real implementation (0G network via @0gfoundation/0g-ts-sdk 1.2.x)
//
// Why @0gfoundation/0g-ts-sdk and not @0glabs/0g-ts-sdk? The latter (0.3.x)
// reverts on Galileo testnet's Flow contract for some submissions; the
// foundation 1.2.x package is the working pattern.
// ---------------------------------------------------------------------------

// SDK doesn't ship usable types; load via dynamic import + any.
let _sdkCache: { Indexer: any; MemData: any } | null = null;
let _sdkError: string | null = null;

async function loadSdk(): Promise<{ Indexer: any; MemData: any }> {
  if (_sdkError) throw new Error(`@0gfoundation/0g-ts-sdk failed to load: ${_sdkError}`);
  if (_sdkCache) return _sdkCache;
  try {
    const mod: any = await import('@0gfoundation/0g-ts-sdk');
    _sdkCache = { Indexer: mod.Indexer, MemData: mod.MemData };
    return _sdkCache;
  } catch (err) {
    _sdkError = String(err);
    throw new Error(`Failed to load @0gfoundation/0g-ts-sdk — install it or set OG_STORAGE_MOCK=1: ${_sdkError}`);
  }
}

/**
 * Real 0G Storage client.
 *
 * Required env:
 *   OG_RPC_URL                     — 0G chain JSON-RPC (default: https://evmrpc-testnet.0g.ai)
 *   OG_INDEXER_URL                 — 0G storage indexer (default: https://indexer-storage-testnet-turbo.0g.ai)
 *   STORAGE_UPLOADER_PRIVATE_KEY   — hex private key of the wallet that pays for storage submissions.
 *                                    Falls back to PLATFORM_EXECUTOR_PRIVATE_KEY if unset.
 *
 * URI scheme: `og://<rootHash>` where rootHash is the 0x-prefixed 32-byte
 * keccak-merkle root returned by the storage layer for the uploaded blob.
 */
function createRealStorage(): OgStorageClient {
  const rpcUrl = process.env.OG_RPC_URL ?? 'https://evmrpc-testnet.0g.ai';
  const indexerUrl = process.env.OG_INDEXER_URL ?? 'https://indexer-storage-testnet-turbo.0g.ai';
  const privateKey = process.env.STORAGE_UPLOADER_PRIVATE_KEY ?? process.env.PLATFORM_EXECUTOR_PRIVATE_KEY ?? '';

  return {
    async upload(key: string, data: Buffer): Promise<string> {
      if (!privateKey) {
        throw new Error('STORAGE_UPLOADER_PRIVATE_KEY (or PLATFORM_EXECUTOR_PRIVATE_KEY) required for real 0G storage');
      }
      const { Indexer, MemData } = await loadSdk();
      const { ethers } = await import('ethers');

      const signer = new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl));
      const indexer = new Indexer(indexerUrl);
      const file = new MemData(data);

      // Galileo testnet's Flow contract intermittently reverts on submit() with a bare
      // `require(false)` — usually transient. Retry with exponential backoff.
      const maxAttempts = Number(process.env.OG_UPLOAD_MAX_ATTEMPTS ?? 5);
      let tx: any = null;
      let lastErr: any = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const [resTx, resErr] = await indexer.upload(file, rpcUrl, signer as any);
        if (!resErr) { tx = resTx; lastErr = null; break; }
        lastErr = resErr;
        const msg = String(resErr?.message ?? resErr);
        const retriable =
          msg.includes('require(false)') ||
          msg.includes('CALL_EXCEPTION') ||
          msg.includes('execution reverted') ||
          msg.includes('NETWORK_ERROR') ||
          msg.includes('TIMEOUT') ||
          msg.includes('SERVER_ERROR');
        if (!retriable || attempt === maxAttempts) break;
        const delayMs = Math.min(15000, 1000 * 2 ** (attempt - 1));
        log.warn(
          { key, attempt, maxAttempts, delayMs, err: msg.slice(0, 200) },
          '0G upload attempt failed — retrying'
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
      if (lastErr) throw new Error(`0G upload failed for key "${key}" after ${maxAttempts} attempts: ${lastErr.message ?? lastErr}`);

      const rootHash: string =
        (tx && (tx.rootHash || tx.root || tx.hash)) ||
        (typeof tx === 'string' ? tx : '');
      if (!rootHash) throw new Error(`0G upload returned no rootHash for key "${key}"`);

      const normalized = rootHash.startsWith('0x') ? rootHash : `0x${rootHash}`;
      if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
        throw new Error(`0G upload returned malformed rootHash for key "${key}": ${rootHash}`);
      }
      return `og://${normalized}`;
    },

    async fetch(uri: string): Promise<Buffer> {
      if (!uri.startsWith('og://')) {
        throw new Error(`Real 0G storage cannot resolve non-og URI: ${uri}`);
      }
      const rootHash = uri.slice('og://'.length);
      const { Indexer } = await loadSdk();
      const indexer = new Indexer(indexerUrl);

      // downloadToBlob returns [blob, error] — same tuple pattern as upload.
      const [blob, err] = await indexer.downloadToBlob(rootHash, {});
      if (err) throw new Error(`0G download failed for URI "${uri}": ${err.message ?? err}`);
      if (!blob) throw new Error(`0G download returned no blob for URI "${uri}"`);
      if (typeof blob.arrayBuffer === 'function') return Buffer.from(await blob.arrayBuffer());
      if (blob instanceof Uint8Array) return Buffer.from(blob);
      if (Buffer.isBuffer(blob)) return blob;
      throw new Error(`0G download returned unexpected blob type for URI "${uri}": ${Object.prototype.toString.call(blob)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an OgStorageClient.
 *
 * @param opts.mock - Force mock mode (overrides OG_STORAGE_MOCK env var)
 */
export function createOgStorage(opts?: { mock?: boolean }): OgStorageClient {
  const useMock =
    opts?.mock === true ||
    process.env.OG_STORAGE_MOCK === '1' ||
    process.env.OG_STORAGE_MOCK === 'true';

  return useMock ? createMockStorage() : createRealStorage();
}
