import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { createIndexes } from '../src/db/indexes.js';

describe('createIndexes', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); });

  it('creates expected indexes', async () => {
    await createIndexes(tdb.db);
    const userIdx = await tdb.db.collection('users').indexes();
    const usernames = userIdx.map(i => i.name);
    expect(usernames).toContain('email_1');
    expect(usernames).toContain('username_1');

    const msgIdx = await tdb.db.collection('messages').indexes();
    expect(msgIdx.map(i => i.name)).toContain('channelId_1_createdAt_-1');
  });

  it('is idempotent (safe to run twice)', async () => {
    await createIndexes(tdb.db);
    await expect(createIndexes(tdb.db)).resolves.not.toThrow();
  });

  it('creates the cascade tree index on messages', async () => {
    await createIndexes(tdb.db);
    const msgIdx = await tdb.db.collection('messages').indexes();
    expect(msgIdx.map(i => i.name)).toContain('cascadeRootId_1_createdAt_1');
  });

  it('creates new INFT and Privy indexes', async () => {
    await createIndexes(tdb.db);
    const userIdx = await tdb.db.collection('users').indexes();
    const userIdxNames = userIdx.map((i: any) => i.name);
    expect(userIdxNames).toContain('privyDid_1');
    expect(userIdxNames).toContain('walletAddress_1');

    const agentIdx = await tdb.db.collection('agents').indexes();
    const agentIdxNames = agentIdx.map((i: any) => i.name);
    expect(agentIdxNames).toContain('tokenId_1');
    expect(agentIdxNames).toContain('ownerWallet_1');

    const mintIdx = await tdb.db.collection('mintReservations').indexes();
    const mintIdxNames = mintIdx.map((i: any) => i.name);
    expect(mintIdxNames).toContain('reservedId_1');
    expect(mintIdxNames).toContain('userId_1');
    expect(mintIdxNames).toContain('slug_1');
    expect(mintIdxNames).toContain('expiresAt_1');
  });

  it('enforces unique username case-insensitively', async () => {
    await createIndexes(tdb.db);
    const users = tdb.db.collection('users');
    await users.insertOne({ username: 'alice', email: 'a@x.com', privyDid: 'did:privy:idx-test-1', walletAddress: null } as any);
    await expect(
      users.insertOne({ username: 'ALICE', email: 'b@x.com', privyDid: 'did:privy:idx-test-2', walletAddress: null } as any)
    ).rejects.toThrow();
  });
});
