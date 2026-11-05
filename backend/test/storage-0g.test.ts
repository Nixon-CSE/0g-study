import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createOgStorage } from '../src/storage-0g/index.js';

// Resolve the .storage-mock directory the same way client.ts does.
// client.ts is at src/storage-0g/client.ts, so mockDir = join(dirname(client), '../..', '.storage-mock')
// From this test file at test/storage-0g.test.ts, backend root is one level up.
const thisFile = fileURLToPath(import.meta.url);
const backendRoot = join(dirname(thisFile), '..');
const storageMockDir = join(backendRoot, '.storage-mock');

async function cleanMockDir(): Promise<void> {
  if (existsSync(storageMockDir)) {
    await rm(storageMockDir, { recursive: true, force: true });
  }
}

beforeEach(async () => {
  // Force mock mode for every test — no real 0G network calls.
  vi.stubEnv('OG_STORAGE_MOCK', '1');
  // Start with a clean mock store so tests are isolated.
  await cleanMockDir();
});

afterAll(async () => {
  // Remove mock directory after the full suite finishes.
  await cleanMockDir();
  vi.unstubAllEnvs();
});

describe('storage-0g mock client', () => {
  it('upload then fetch returns identical bytes', async () => {
    const client = createOgStorage();
    const original = Buffer.from('hello bonfire INFT storage', 'utf8');

    const uri = await client.upload('publicManifest/1.json', original);

    expect(uri).toMatch(/^mock:\/\//);

    const fetched = await client.fetch(uri);
    expect(fetched).toEqual(original);
  });

  it('fetch non-existent URI throws an error', async () => {
    const client = createOgStorage();
    // A URI whose hash does not exist in the mock store.
    const fakeUri = 'mock://0000000000000000000000000000000000000000000000000000000000000000';

    await expect(client.fetch(fakeUri)).rejects.toThrow();
  });

  it('uploading the same key twice with different data overwrites — fetch returns new data', async () => {
    const client = createOgStorage();
    const key = 'encryptedBundle/7.bin';

    const first = Buffer.from('first payload');
    const second = Buffer.from('second payload — different bytes');

    const uri1 = await client.upload(key, first);
    const uri2 = await client.upload(key, second);

    // Same key produces the same URI (deterministic sha256 of key).
    expect(uri1).toBe(uri2);

    const fetched = await client.fetch(uri2);
    // The store should reflect the second write.
    expect(fetched).toEqual(second);
    expect(fetched).not.toEqual(first);
  });

  it('opts.mock=true forces mock mode regardless of env', async () => {
    // Even if env were unset, explicit opts.mock should use mock impl.
    vi.stubEnv('OG_STORAGE_MOCK', '0');
    const client = createOgStorage({ mock: true });

    const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const uri = await client.upload('sealedDEK/3/shared.bin', data);
    const back = await client.fetch(uri);

    expect(back).toEqual(data);
  });

  it('upload produces a key-preserving mock:// URI (so baseUri + "/shared.bin" sub-URIs resolve)', async () => {
    const client = createOgStorage();

    const key = 'publicManifest/99.json';
    const uri = await client.upload(key, Buffer.from('{}'));
    expect(uri).toBe(`mock://${encodeURIComponent(key)}`);
    expect((await client.fetch(uri)).toString()).toBe('{}');
  });
});
