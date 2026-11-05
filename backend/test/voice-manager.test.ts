/**
 * Unit tests for VoiceManager.
 *
 * Daily client and spawnBot are replaced with test doubles — no real HTTP calls
 * or subprocesses. Mongo is in-memory via mongodb-memory-server.
 *
 * Scenarios:
 *  - First join creates a room but does NOT spawn a bot
 *  - Second join reuses the session (no spawn)
 *  - Leave decrements participant count
 *  - Last participant leaving (no bots) kills nothing + deletes room + marks ended
 *  - Last participant leaving with bots present → kills all bots, tears down room
 *  - inviteAgent spawns bot, appends to session.bots[]
 *  - Inviting same agent twice → throws AgentAlreadyInvitedError
 *  - kickAgent kills the spawn for that slug, removes from bots[]
 *  - sweep() tears down expired sessions (kills all bots in each)
 *  - shutdown() kills all bots across all sessions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { createIndexes } from '../src/db/indexes.js';
import { VoiceManager, AgentAlreadyInvitedError } from '../src/voice/manager.js';
import type { DailyClient, DailyRoom } from '../src/voice/daily-client.js';
import type { ChannelDoc, UserDoc, VoiceSessionDoc, AgentDoc } from '../src/db/types.js';
import { collections } from '../src/db/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDailyClient(): DailyClient & {
  rooms: Map<string, DailyRoom>;
  deletedRooms: string[];
  tokens: string[];
} {
  const rooms = new Map<string, DailyRoom>();
  const deletedRooms: string[] = [];
  const tokens: string[] = [];
  let roomSeq = 0;
  let tokenSeq = 0;

  return {
    rooms,
    deletedRooms,
    tokens,
    async createRoom({ expSeconds }) {
      const name = `room-${++roomSeq}`;
      const url = `https://test.daily.co/${name}`;
      const r: DailyRoom = { name, url, expiresAtUnix: Math.floor(Date.now() / 1000) + expSeconds };
      rooms.set(name, r);
      return r;
    },
    async deleteRoom(name) {
      deletedRooms.push(name);
      rooms.delete(name);
    },
    async mintMeetingToken({ roomName, userName }) {
      const tok = `tok-${++tokenSeq}-${roomName}-${userName}`;
      tokens.push(tok);
      return tok;
    },
  };
}

function makeSpawnBot(): {
  spawner: (env: Record<string, string>) => { pid: number; kill: () => void };
  spawnCount: () => number;
  killCount: () => number;
} {
  let spawnCount = 0;
  let killCount = 0;
  let pidSeq = 1000;

  const spawner = (_env: Record<string, string>) => {
    spawnCount++;
    const pid = ++pidSeq;
    return {
      pid,
      kill: () => { killCount++; },
    };
  };

  return {
    spawner,
    spawnCount: () => spawnCount,
    killCount: () => killCount,
  };
}

function makeChannel(_db: any, overrides: Partial<ChannelDoc> = {}): ChannelDoc {
  return {
    _id: new ObjectId(),
    serverId: new ObjectId(),
    name: 'voice-general',
    topic: null,
    type: 'voice',
    defaultAgentId: null,
    position: 1,
    createdAt: new Date(),
    ...overrides,
  } as ChannelDoc;
}

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    _id: new ObjectId(),
    privyDid: `did:privy:test-${Math.random().toString(36).slice(2)}`,
    walletAddress: null,
    email: null,
    passwordHash: null,
    username: `user-${Math.random().toString(36).slice(2, 8)}`,
    displayName: 'Test User',
    avatarUrl: null,
    bio: null,
    isService: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserDoc;
}

/** Minimal INFT-backed agent doc. */
function makeAgent(overrides: Partial<AgentDoc> = {}): AgentDoc {
  const slug = overrides.slug ?? `agent-${Math.random().toString(36).slice(2, 8)}`;
  return {
    _id: new ObjectId(),
    name: slug,
    slug,
    avatarUrl: null,
    description: 'test agent',
    bio: null,
    tags: [],
    baseUrl: 'https://example.com',
    visibility: 'public',
    createdBy: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    // INFT fields — without these inviteAgent skips decryption but still spawns
    tokenId: '42',
    contractAddress: '0xdeadbeef',
    ...overrides,
  } as AgentDoc;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VoiceManager', () => {
  let tdb: TestDb;
  let daily: ReturnType<typeof makeDailyClient>;
  let spawn: ReturnType<typeof makeSpawnBot>;
  let manager: VoiceManager;

  beforeAll(async () => {
    tdb = await startTestDb();
  });
  afterAll(async () => { await stopTestDb(); });

  beforeEach(async () => {
    await cleanCollections(tdb.db);
    await createIndexes(tdb.db);
    daily = makeDailyClient();
    spawn = makeSpawnBot();
    manager = new VoiceManager({
      db: tdb.db,
      daily,
      spawnBot: spawn.spawner,
    });
  });

  // ── joinChannel ──────────────────────────────────────────────────────────────

  it('first join creates a Daily room but does NOT spawn a bot', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();

    const { session, userToken } = await manager.joinChannel({ channel, user });

    expect(session.status).toBe('active');
    expect(session.channelId.equals(channel._id)).toBe(true);
    expect(session.participantIds).toHaveLength(1);
    // No bot spawned on join
    expect(spawn.spawnCount()).toBe(0);
    expect(session.bots).toEqual([]);
    expect(userToken).toBeTruthy();
    expect(daily.rooms.size).toBe(1);
  });

  it('second join reuses the session without spawning a new bot', async () => {
    const channel = makeChannel(tdb.db);
    const user1 = makeUser();
    const user2 = makeUser();

    const r1 = await manager.joinChannel({ channel, user: user1 });
    const r2 = await manager.joinChannel({ channel, user: user2 });

    expect(spawn.spawnCount()).toBe(0);
    expect(r1.session._id.equals(r2.session._id)).toBe(true);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: r1.session._id });
    expect(stored?.participantIds).toHaveLength(2);
  });

  it('leave decrements participant count', async () => {
    const channel = makeChannel(tdb.db);
    const user1 = makeUser();
    const user2 = makeUser();

    const { session } = await manager.joinChannel({ channel, user: user1 });
    await manager.joinChannel({ channel, user: user2 });

    const { ended } = await manager.leaveChannel({ sessionId: session._id, user: user1 });
    expect(ended).toBe(false);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.participantIds).toHaveLength(1);
    expect(spawn.killCount()).toBe(0);
  });

  it('last participant leaving (no bots) deletes room and marks session ended', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();

    const { session } = await manager.joinChannel({ channel, user });
    const roomName = session.dailyRoomName;

    const { ended } = await manager.leaveChannel({ sessionId: session._id, user });
    expect(ended).toBe(true);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.status).toBe('ended');
    expect(stored?.endedAt).toBeInstanceOf(Date);
    expect(daily.deletedRooms).toContain(roomName);
    expect(spawn.killCount()).toBe(0);
  });

  // ── inviteAgent ──────────────────────────────────────────────────────────────

  it('inviteAgent spawns a bot and appends a VoiceBotEntry to session.bots[]', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent = makeAgent();

    const { session } = await manager.joinChannel({ channel, user });
    const { bot } = await manager.inviteAgent({ session, agent, invitedBy: user });

    expect(spawn.spawnCount()).toBe(1);
    expect(bot.agentSlug).toBe(agent.slug);
    expect(bot.pid).toBeGreaterThan(0);
    expect(bot.invitedByUserId.equals(user._id)).toBe(true);
    expect(bot.invitedAt).toBeInstanceOf(Date);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.bots).toHaveLength(1);
    expect(stored?.bots[0].agentSlug).toBe(agent.slug);
  });

  it('inviting a second distinct agent spawns a second bot', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent1 = makeAgent({ slug: 'alpha' });
    const agent2 = makeAgent({ slug: 'beta' });

    const { session } = await manager.joinChannel({ channel, user });
    await manager.inviteAgent({ session, agent: agent1, invitedBy: user });
    // Reload session so bots[] is current
    const sessionV2 = (await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id }))!;
    await manager.inviteAgent({ session: sessionV2, agent: agent2, invitedBy: user });

    expect(spawn.spawnCount()).toBe(2);
    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.bots).toHaveLength(2);
  });

  it('inviting the same agent twice throws AgentAlreadyInvitedError', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent = makeAgent({ slug: 'dupe-agent' });

    const { session } = await manager.joinChannel({ channel, user });
    await manager.inviteAgent({ session, agent, invitedBy: user });

    // Reload session to reflect updated bots[]
    const sessionV2 = (await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id }))!;

    await expect(
      manager.inviteAgent({ session: sessionV2, agent, invitedBy: user }),
    ).rejects.toBeInstanceOf(AgentAlreadyInvitedError);

    // No second spawn
    expect(spawn.spawnCount()).toBe(1);
  });

  // ── kickAgent ────────────────────────────────────────────────────────────────

  it('kickAgent terminates the bot subprocess and removes the entry from bots[]', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent = makeAgent({ slug: 'kick-me' });

    const { session } = await manager.joinChannel({ channel, user });
    await manager.inviteAgent({ session, agent, invitedBy: user });

    const sessionWithBot = (await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id }))!;

    const { removed } = await manager.kickAgent({
      session: sessionWithBot,
      agentSlug: 'kick-me',
      requestedBy: user,
    });

    expect(removed).toBe(true);
    expect(spawn.killCount()).toBe(1);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.bots).toHaveLength(0);
  });

  it('kickAgent returns removed: false when slug is not in the session', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();

    const { session } = await manager.joinChannel({ channel, user });

    const { removed } = await manager.kickAgent({
      session,
      agentSlug: 'does-not-exist',
      requestedBy: user,
    });

    expect(removed).toBe(false);
    expect(spawn.killCount()).toBe(0);
  });

  // ── leaveChannel with bots ───────────────────────────────────────────────────

  it('last participant leaving while bots are present kills all bots then tears down room', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent1 = makeAgent({ slug: 'bot-a' });
    const agent2 = makeAgent({ slug: 'bot-b' });

    const { session } = await manager.joinChannel({ channel, user });
    const roomName = session.dailyRoomName;

    await manager.inviteAgent({ session, agent: agent1, invitedBy: user });
    const sessionV2 = (await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id }))!;
    await manager.inviteAgent({ session: sessionV2, agent: agent2, invitedBy: user });

    // Both bots are alive
    expect(spawn.spawnCount()).toBe(2);
    expect(spawn.killCount()).toBe(0);

    // Load fresh session doc for leaveChannel
    const sessionV3 = (await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id }))!;

    const { ended } = await manager.leaveChannel({ sessionId: sessionV3._id, user });

    expect(ended).toBe(true);
    // Both bots should have been killed
    expect(spawn.killCount()).toBe(2);
    expect(daily.deletedRooms).toContain(roomName);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.status).toBe('ended');
  });

  // ── sweep ────────────────────────────────────────────────────────────────────

  it('sweep() tears down expired sessions (including their bots) and returns count', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent = makeAgent({ slug: 'sweep-bot' });

    const { session } = await manager.joinChannel({ channel, user });
    const roomName = session.dailyRoomName;
    await manager.inviteAgent({ session, agent, invitedBy: user });

    // Backdate expiresAt so the sweeper picks it up
    await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .updateOne(
        { _id: session._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    const count = await manager.sweep();
    expect(count).toBe(1);

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.status).toBe('ended');
    expect(daily.deletedRooms).toContain(roomName);
    // The bot spawned by inviteAgent must have been killed
    expect(spawn.killCount()).toBe(1);
  });

  it('sweep() ignores already-ended sessions', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();

    const { session } = await manager.joinChannel({ channel, user });

    await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .updateOne({ _id: session._id }, {
        $set: {
          status: 'ended',
          endedAt: new Date(),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

    const count = await manager.sweep();
    expect(count).toBe(0);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────────

  it('shutdown() kills all bots across all sessions', async () => {
    const channel1 = makeChannel(tdb.db);
    const channel2 = makeChannel(tdb.db);
    const user1 = makeUser();
    const user2 = makeUser();
    const agent1 = makeAgent({ slug: 'shutdown-a' });
    const agent2 = makeAgent({ slug: 'shutdown-b' });

    const { session: s1 } = await manager.joinChannel({ channel: channel1, user: user1 });
    await manager.inviteAgent({ session: s1, agent: agent1, invitedBy: user1 });

    const { session: s2 } = await manager.joinChannel({ channel: channel2, user: user2 });
    await manager.inviteAgent({ session: s2, agent: agent2, invitedBy: user2 });

    expect(spawn.spawnCount()).toBe(2);

    await manager.shutdown();
    expect(spawn.killCount()).toBe(2);
  });

  // ── status ───────────────────────────────────────────────────────────────────

  it('status() returns null when no active session', async () => {
    const channelId = new ObjectId();
    const result = await manager.status(channelId);
    expect(result).toBeNull();
  });

  it('status() returns the active session with bots normalised to []', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    await manager.joinChannel({ channel, user });

    const result = await manager.status(channel._id);
    expect(result).not.toBeNull();
    expect(result!.channelId.equals(channel._id)).toBe(true);
    expect(result!.status).toBe('active');
    expect(Array.isArray(result!.bots)).toBe(true);
  });

  // ── backwards compat (legacy rows without bots field) ───────────────────────

  it('tolerates legacy VoiceSessionDoc rows that have no bots field', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const col = tdb.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    // Insert a synthetic legacy row (as if written by the old single-bot manager)
    const legacySession: any = {
      _id: new ObjectId(),
      channelId: channel._id,
      serverId: channel.serverId,
      dailyRoomName: 'legacy-room',
      dailyRoomUrl: 'https://test.daily.co/legacy-room',
      agentSlug: 'old-agent',
      agentSoul: '',
      participantIds: [user._id],
      pythonPid: 9999,
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 600_000),
      endedAt: null,
      // NOTE: no `bots` field — simulates a pre-migration row
    };
    await col.insertOne(legacySession);

    // status() should return the session and normalise bots to []
    const result = await manager.status(channel._id);
    expect(result).not.toBeNull();
    expect(result!.bots).toEqual([]);

    // leaveChannel should still work cleanly (no crash on missing bots)
    const { ended } = await manager.leaveChannel({ sessionId: legacySession._id, user });
    expect(ended).toBe(true);
  });

  it('spawn failure during invite rolls back: does not append to bots[]', async () => {
    const channel = makeChannel(tdb.db);
    const user = makeUser();
    const agent = makeAgent({ slug: 'fail-bot' });

    const failingSpawn = () => { throw new Error('pipecat not found'); };
    const badManager = new VoiceManager({ db: tdb.db, daily, spawnBot: failingSpawn });

    const { session } = await manager.joinChannel({ channel, user });

    await expect(
      badManager.inviteAgent({ session, agent, invitedBy: user }),
    ).rejects.toThrow('bot spawn failed');

    const stored = await tdb.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({ _id: session._id });
    expect(stored?.bots).toHaveLength(0);
  });
});
