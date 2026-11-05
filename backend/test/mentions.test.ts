import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { collections } from '../src/db/types.js';
import { resolveMentions } from '../src/messages/mentions.js';

describe('resolveMentions', () => {
  let tdb: TestDb;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); });

  it('resolves a user mention', async () => {
    const userId = new ObjectId();
    const serverId = new ObjectId();
    await tdb.db.collection(collections.users).insertOne({
      _id: userId, username: 'alice', privyDid: 'did:privy:mentions-test', walletAddress: null,
      email: 'a@x', passwordHash: null, displayName: 'A',
      avatarUrl: null, bio: null, isService: false,
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    await tdb.db.collection(collections.serverMembers).insertOne({
      _id: new ObjectId(), serverId, principalType: 'user', principalId: userId,
      role: 'member', alias: null, joinedAt: new Date(),
    } as any);

    const out = await resolveMentions(tdb.db, serverId, 'hey @alice ping');
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('user');
    expect(out[0].id.equals(userId)).toBe(true);
  });

  it('resolves an agent mention', async () => {
    const agentId = new ObjectId();
    const serverId = new ObjectId();
    await tdb.db.collection(collections.agents).insertOne({
      _id: agentId, name: 'R', slug: 'researcher', baseUrl: 'http://x',
      description: '', bio: null, tags: [], avatarUrl: null,
      visibility: 'public', createdBy: new ObjectId(),
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    await tdb.db.collection(collections.serverMembers).insertOne({
      _id: new ObjectId(), serverId, principalType: 'agent', principalId: agentId,
      role: 'member', alias: null, joinedAt: new Date(),
    } as any);

    const out = await resolveMentions(tdb.db, serverId, '@researcher please');
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('agent');
    expect(out[0].id.equals(agentId)).toBe(true);
  });

  it('ignores @handles that are not server members', async () => {
    const serverId = new ObjectId();
    const out = await resolveMentions(tdb.db, serverId, '@nobody @stranger');
    expect(out).toEqual([]);
  });

  it('deduplicates repeated mentions', async () => {
    const agentId = new ObjectId();
    const serverId = new ObjectId();
    await tdb.db.collection(collections.agents).insertOne({
      _id: agentId, name: 'R', slug: 'researcher', baseUrl: 'http://x',
      description: '', bio: null, tags: [], avatarUrl: null,
      visibility: 'public', createdBy: new ObjectId(),
      createdAt: new Date(), updatedAt: new Date(),
    } as any);
    await tdb.db.collection(collections.serverMembers).insertOne({
      _id: new ObjectId(), serverId, principalType: 'agent', principalId: agentId,
      role: 'member', alias: null, joinedAt: new Date(),
    } as any);

    const out = await resolveMentions(tdb.db, serverId, '@researcher @researcher');
    expect(out.length).toBe(1);
  });
});
