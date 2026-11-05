import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { createIndexes } from '../src/db/indexes.js';
import { collections } from '../src/db/types.js';
import type { UserDoc, MintReservationDoc } from '../src/db/types.js';

describe('db-types schema', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); await createIndexes(tdb.db); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); await createIndexes(tdb.db); });

  it('inserts a UserDoc with only privyDid — no email or passwordHash', async () => {
    const col = tdb.db.collection<UserDoc>(collections.users);
    const doc: UserDoc = {
      _id: new ObjectId(),
      privyDid: 'did:privy:test-only-privy',
      walletAddress: null,
      email: null,
      passwordHash: null,
      username: 'privy-only-user',
      displayName: 'Privy Only',
      avatarUrl: null,
      bio: null,
      isService: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await expect(col.insertOne(doc)).resolves.toBeTruthy();
    const fetched = await col.findOne({ privyDid: 'did:privy:test-only-privy' });
    expect(fetched).not.toBeNull();
    expect(fetched!.email).toBeNull();
    expect(fetched!.passwordHash).toBeNull();
  });

  it('TTL index exists on mintReservations.expiresAt', async () => {
    const col = tdb.db.collection(collections.mintReservations);
    const indexes = await col.indexes();
    const ttlIdx = indexes.find((i: any) => i.name === 'expiresAt_1');
    expect(ttlIdx).toBeDefined();
    expect(ttlIdx!.expireAfterSeconds).toBe(0);
  });

  it('inserts a MintReservationDoc with expiresAt in the past — TTL index present', async () => {
    const col = tdb.db.collection<MintReservationDoc>(collections.mintReservations);
    const past = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    const doc: MintReservationDoc = {
      _id: new ObjectId(),
      reservedId: 'test-reserved-id-ttl',
      userId: new ObjectId(),
      slug: 'ttl-test-agent',
      manifestUri: 'ipfs://QmManifest',
      bundleUri: 'ipfs://QmBundle',
      sealedDEKBaseUri: 'ipfs://QmDEK',
      bundleHash: 'deadbeef',
      status: 'uploaded',
      createdAt: past,
      expiresAt: past,
    };
    await expect(col.insertOne(doc)).resolves.toBeTruthy();
    // Verify TTL index is defined (mongo-memory-server doesn't actually run TTL cleanup,
    // but the index must exist for production expiry to work)
    const indexes = await col.indexes();
    expect(indexes.map((i: any) => i.name)).toContain('expiresAt_1');
  });

  it('rejects a second MintReservationDoc with the same slug (unique constraint)', async () => {
    const col = tdb.db.collection<MintReservationDoc>(collections.mintReservations);
    const userId = new ObjectId();
    const base = {
      userId,
      slug: 'unique-slug-test',
      manifestUri: 'ipfs://QmM',
      bundleUri: 'ipfs://QmB',
      sealedDEKBaseUri: 'ipfs://QmD',
      bundleHash: 'abc123',
      status: 'uploaded' as const,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    };

    await col.insertOne({ _id: new ObjectId(), reservedId: 'res-1', ...base });
    await expect(
      col.insertOne({ _id: new ObjectId(), reservedId: 'res-2', ...base })
    ).rejects.toThrow();
  });
});
