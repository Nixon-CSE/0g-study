import type { Db } from 'mongodb';
import { collections } from './types.js';

export async function createIndexes(db: Db): Promise<void> {
  const ci = { locale: 'en', strength: 2 } as const;

  await db.collection(collections.users).createIndexes([
    { key: { email: 1 }, name: 'email_1', unique: true, collation: ci, sparse: true },
    { key: { username: 1 }, name: 'username_1', unique: true, collation: ci },
    { key: { privyDid: 1 }, name: 'privyDid_1', unique: true },
    { key: { walletAddress: 1 }, name: 'walletAddress_1', unique: true, sparse: true },
  ]);

  await db.collection(collections.agents).createIndexes([
    { key: { slug: 1 }, name: 'slug_1', unique: true, collation: ci },
    { key: { visibility: 1, tags: 1 }, name: 'visibility_1_tags_1' },
    { key: { tokenId: 1 }, name: 'tokenId_1', unique: true, sparse: true },
    { key: { ownerWallet: 1 }, name: 'ownerWallet_1' },
  ]);

  await db.collection(collections.servers).createIndexes([
    { key: { slug: 1 }, name: 'slug_1', unique: true, collation: ci },
    { key: { ownerId: 1 }, name: 'ownerId_1' },
  ]);

  await db.collection(collections.serverMembers).createIndexes([
    { key: { serverId: 1, principalType: 1, principalId: 1 }, name: 'serverId_1_principalType_1_principalId_1', unique: true },
    { key: { principalId: 1, principalType: 1 }, name: 'principalId_1_principalType_1' },
    // Replay guard for paid invites — the unique constraint is the actual
    // gate; the route relies on the resulting E11000 to detect duplicates
    // (avoids the TOCTOU window a findOne pre-check would leave open).
    // Sparse — only paid invites have this field set.
    { key: { paidTxHash: 1 }, name: 'paidTxHash_1', unique: true, sparse: true },
  ]);

  await db.collection(collections.channels).createIndexes([
    { key: { serverId: 1, name: 1 }, name: 'serverId_1_name_1', unique: true },
    { key: { serverId: 1, position: 1 }, name: 'serverId_1_position_1' },
  ]);

  await db.collection(collections.messages).createIndexes([
    { key: { channelId: 1, createdAt: -1 }, name: 'channelId_1_createdAt_-1' },
    { key: { serverId: 1, createdAt: -1 }, name: 'serverId_1_createdAt_-1' },
    { key: { cascadeRootId: 1, createdAt: 1 }, name: 'cascadeRootId_1_createdAt_1' },
  ]);

  await db.collection(collections.mintReservations).createIndexes([
    { key: { reservedId: 1 }, name: 'reservedId_1', unique: true },
    { key: { userId: 1 }, name: 'userId_1' },
    { key: { slug: 1 }, name: 'slug_1', unique: true, sparse: true },
    { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 },
  ]);

  // voice sessions: channelId lookup, status filter, and TTL cleanup of ended sessions
  await db.collection(collections.voiceSessions).createIndexes([
    { key: { channelId: 1 }, name: 'channelId_1' },
    { key: { status: 1 }, name: 'status_1' },
    // TTL: drop ended sessions 1 hour after they expire
    { key: { expiresAt: 1 }, name: 'expiresAt_1_ttl', expireAfterSeconds: 3600 },
  ]);

  // Knowledge docs: per-server lookups + text search for agent retrieval.
  await db.collection(collections.knowledgeDocs).createIndexes([
    { key: { serverId: 1, createdAt: -1 }, name: 'serverId_1_createdAt_-1' },
    { key: { channelId: 1 }, name: 'channelId_1' },
    {
      key: { title: 'text', content: 'text' },
      name: 'title_content_text',
      weights: { title: 5, content: 1 },
      default_language: 'english',
    },
  ]);
}
