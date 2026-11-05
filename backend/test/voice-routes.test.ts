/**
 * Integration tests for voice HTTP routes.
 *
 * Uses an in-memory Mongo + fake VoiceManager to exercise the HTTP layer.
 *
 * Scenarios:
 *  - 200 on join (voice channel)
 *  - 200 on leave
 *  - 200 on status (active + inactive, bots field included)
 *  - 409 on join when channel.type !== 'voice'
 *  - 503 when VoiceManager throws BotSpawnError
 *  - 401 without auth token
 *  - POST /invite-agent → 200, 404 (no session), 404 (no agent), 400 (non-INFT), 409 (duplicate)
 *  - POST /kick-agent → 200, 404
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { Hono } from 'hono';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq, TEST_JWT_SECRET } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { createIndexes } from '../src/db/indexes.js';
import { voiceRoutes } from '../src/api/routes/voice.js';
import { VoiceManager, BotSpawnError, AgentAlreadyInvitedError } from '../src/voice/manager.js';
import type { ChannelDoc, VoiceSessionDoc, AgentDoc, VoiceBotEntry } from '../src/db/types.js';
import { collections } from '../src/db/types.js';

// ── Fake VoiceManager ────────────────────────────────────────────────────────

function makeFakeVoiceManager(_db: any) {
  const calls: { method: string; args: any[] }[] = [];
  const sessionStore = new Map<string, VoiceSessionDoc>();

  const manager = {
    async joinChannel({ channel, user }: any) {
      calls.push({ method: 'joinChannel', args: [channel, user] });
      const session: VoiceSessionDoc = {
        _id: new ObjectId(),
        channelId: channel._id,
        serverId: channel.serverId,
        dailyRoomName: 'test-room',
        dailyRoomUrl: 'https://test.daily.co/test-room',
        agentSlug: null,
        agentSoul: '',
        participantIds: [user._id],
        pythonPid: null,
        bots: [],
        status: 'active',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
        endedAt: null,
      };
      sessionStore.set(session._id.toHexString(), session);
      return { session, userToken: 'test-user-token' };
    },
    async leaveChannel({ sessionId, user }: any) {
      calls.push({ method: 'leaveChannel', args: [sessionId, user] });
      return { ended: true };
    },
    async inviteAgent({ session, agent, invitedBy }: any) {
      calls.push({ method: 'inviteAgent', args: [session, agent, invitedBy] });
      const bot: VoiceBotEntry = {
        agentDocId: agent._id,
        agentSlug: agent.slug,
        pid: 5000,
        invitedByUserId: invitedBy._id,
        invitedAt: new Date(),
      };
      return { bot };
    },
    async kickAgent({ session, agentSlug, requestedBy }: any) {
      calls.push({ method: 'kickAgent', args: [session, agentSlug, requestedBy] });
      return { removed: true };
    },
    async status(_channelId: ObjectId) {
      calls.push({ method: 'status', args: [_channelId] });
      return null;
    },
    async sweep() { return 0; },
    async shutdown() {},
    _calls: calls,
  } as unknown as VoiceManager & { _calls: typeof calls };

  return manager;
}

function makeFailingVoiceManager() {
  return {
    async joinChannel() {
      throw new BotSpawnError('python exploded');
    },
    async leaveChannel() { return { ended: false }; },
    async inviteAgent() { throw new BotSpawnError('spawn failed'); },
    async kickAgent() { return { removed: false }; },
    async status() { return null; },
    async sweep() { return 0; },
    async shutdown() {},
  } as unknown as VoiceManager;
}

// ── App builder with voice routes ────────────────────────────────────────────

async function makeVoiceApp(db: any, voiceManager: VoiceManager) {
  await createIndexes(db);
  const baseApp = makeApp(db);
  const { buildApp } = await import('../src/api/server.js');
  return buildApp({
    db,
    jwtSecret: TEST_JWT_SECRET,
    jwtExpiresIn: '1h',
    voiceManager,
  });
}

// ── Seed helpers ─────────────────────────────────────────────────────────────

async function seedChannel(db: any, overrides: Partial<ChannelDoc> = {}): Promise<ChannelDoc> {
  const serverId = new ObjectId();
  const doc: ChannelDoc = {
    _id: new ObjectId(),
    serverId,
    name: 'voice-general',
    topic: null,
    type: 'voice',
    defaultAgentId: null,
    position: 1,
    createdAt: new Date(),
    ...overrides,
  } as ChannelDoc;
  await db.collection(collections.channels).insertOne(doc);
  return doc;
}

async function seedAgent(db: any, overrides: Partial<AgentDoc> = {}): Promise<AgentDoc> {
  const slug = overrides.slug ?? `agent-${Math.random().toString(36).slice(2, 8)}`;
  const doc: AgentDoc = {
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
    tokenId: '42',
    contractAddress: '0xdeadbeef',
    ...overrides,
  } as AgentDoc;
  await db.collection(collections.agents).insertOne(doc);
  return doc;
}

async function seedActiveSession(
  db: any,
  channelId: ObjectId,
  serverId: ObjectId,
  userId: ObjectId,
  botEntries: VoiceBotEntry[] = [],
): Promise<VoiceSessionDoc> {
  const doc: VoiceSessionDoc = {
    _id: new ObjectId(),
    channelId,
    serverId,
    dailyRoomName: 'seeded-room',
    dailyRoomUrl: 'https://test.daily.co/seeded-room',
    participantIds: [userId],
    bots: botEntries,
    status: 'active',
    startedAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    endedAt: null,
  };
  await db.collection(collections.voiceSessions).insertOne(doc);
  return doc;
}

async function addUserToServer(db: any, userId: ObjectId, serverId: ObjectId) {
  await db.collection(collections.serverMembers).insertOne({
    _id: new ObjectId(),
    serverId,
    principalType: 'user',
    principalId: userId,
    role: 'member',
    alias: null,
    joinedAt: new Date(),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('voice routes', () => {
  let tdb: TestDb;
  let baseApp: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => {
    // Drain any fire-and-forget Mongo ops kicked off by route handlers.
    await new Promise((r) => setTimeout(r, 200));
    await stopTestDb();
  });

  beforeEach(async () => {
    await cleanCollections(tdb.db);
    baseApp = await makeApp(tdb.db);
  });

  // ── POST /join — happy path ────────────────────────────────────────────────

  it('POST /join returns 200 with roomUrl, token, sessionId for voice channel', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/join`, {}, token);
    expect(r.status).toBe(200);
    expect(r.body.roomUrl).toMatch(/^https:\/\//);
    expect(r.body.token).toBeTruthy();
    expect(r.body.sessionId).toMatch(/^[a-f0-9]{24}$/);
    expect(r.body.expiresAt).toBeTruthy();
  });

  // ── POST /join — non-voice channel → 409 ─────────────────────────────────

  it('POST /join returns 409 when channel type is not voice', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'text' } as any);
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/join`, {}, token);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('channel_not_voice');
  });

  // ── POST /join — BotSpawnError → 503 ─────────────────────────────────────

  it('POST /join returns 503 when bot spawn fails', async () => {
    const app = await makeVoiceApp(tdb.db, makeFailingVoiceManager());

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/join`, {}, token);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('bot_spawn_failed');
  });

  // ── POST /join — no auth → 401 ────────────────────────────────────────────

  it('POST /join without token returns 401', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);
    const channel = await seedChannel(tdb.db);

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/join`, {});
    expect([401, 503]).toContain(r.status);
  });

  // ── POST /leave — happy path ──────────────────────────────────────────────

  it('POST /leave returns 200 with ok + ended', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const joinRes = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/join`, {}, token);
    const sessionId = joinRes.body.sessionId;

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/leave`,
      { sessionId }, token);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.ended).toBe('boolean');
  });

  // ── POST /leave — missing sessionId → 400 ────────────────────────────────

  it('POST /leave with missing sessionId returns 400', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'POST', `/v1/channels/${channel._id.toHexString()}/voice/leave`, {}, token);
    expect(r.status).toBe(400);
  });

  // ── GET /status — no session ──────────────────────────────────────────────

  it('GET /status returns active: false when no session', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'GET', `/v1/channels/${channel._id.toHexString()}/voice/status`, undefined, token);
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);
  });

  // ── GET /status — active session with bots ────────────────────────────────

  it('GET /status returns active: true with bots[] in the response', async () => {
    const channelId = new ObjectId();
    const sessionId = new ObjectId();
    const botEntry: VoiceBotEntry = {
      agentDocId: new ObjectId(),
      agentSlug: 'invited-agent',
      pid: 7777,
      invitedByUserId: new ObjectId(),
      invitedAt: new Date(),
    };
    const mockSession: VoiceSessionDoc = {
      _id: sessionId,
      channelId,
      serverId: new ObjectId(),
      dailyRoomName: 'active-room',
      dailyRoomUrl: 'https://test.daily.co/active-room',
      participantIds: [new ObjectId()],
      bots: [botEntry],
      status: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
      endedAt: null,
    };

    const activeManager = {
      async joinChannel() { return { session: mockSession, userToken: 'tok' }; },
      async leaveChannel() { return { ended: false }; },
      async inviteAgent() { return { bot: botEntry }; },
      async kickAgent() { return { removed: false }; },
      async status(_cid: ObjectId) { return mockSession; },
      async sweep() { return 0; },
      async shutdown() {},
    } as unknown as VoiceManager;

    const app = await makeVoiceApp(tdb.db, activeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { _id: channelId, type: 'voice' } as any);
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(app, 'GET', `/v1/channels/${channelId.toHexString()}/voice/status`, undefined, token);
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(true);
    expect(r.body.sessionId).toBe(sessionId.toHexString());
    expect(r.body.participantCount).toBe(1);
    expect(Array.isArray(r.body.bots)).toBe(true);
    expect(r.body.bots).toHaveLength(1);
    expect(r.body.bots[0].agentSlug).toBe('invited-agent');
  });

  // ── POST /invite-agent — happy path ──────────────────────────────────────

  it('POST /invite-agent returns 200 with bot entry on success', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const agent = await seedAgent(tdb.db, { slug: 'invited-bot', tokenId: '99' });
    const session = await seedActiveSession(tdb.db, channel._id, channel.serverId, new ObjectId(user.id));

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/invite-agent`,
      { sessionId: session._id.toHexString(), agentSlug: agent.slug },
      token,
    );

    expect(r.status).toBe(200);
    expect(r.body.bot.agentSlug).toBe(agent.slug);
    expect(r.body.bot.invitedAt).toBeTruthy();
    expect(r.body.bot.agentDocId).toMatch(/^[a-f0-9]{24}$/);
  });

  // ── POST /invite-agent — session not found → 404 ─────────────────────────

  it('POST /invite-agent returns 404 when session does not exist', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const agent = await seedAgent(tdb.db);

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/invite-agent`,
      { sessionId: new ObjectId().toHexString(), agentSlug: agent.slug },
      token,
    );

    expect(r.status).toBe(404);
    expect(r.body.error).toBe('session_not_found');
  });

  // ── POST /invite-agent — agent not found → 404 ───────────────────────────

  it('POST /invite-agent returns 404 when agent slug does not exist', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const session = await seedActiveSession(tdb.db, channel._id, channel.serverId, new ObjectId(user.id));

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/invite-agent`,
      { sessionId: session._id.toHexString(), agentSlug: 'no-such-agent' },
      token,
    );

    expect(r.status).toBe(404);
    expect(r.body.error).toBe('agent_not_found');
  });

  // ── POST /invite-agent — non-INFT agent → 400 ────────────────────────────

  it('POST /invite-agent returns 400 for a non-INFT-backed agent', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    // Agent with no tokenId — not INFT-backed
    const agent = await seedAgent(tdb.db, { slug: 'plain-agent', tokenId: undefined });
    const session = await seedActiveSession(tdb.db, channel._id, channel.serverId, new ObjectId(user.id));

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/invite-agent`,
      { sessionId: session._id.toHexString(), agentSlug: agent.slug },
      token,
    );

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('agent_not_invitable');
  });

  // ── POST /invite-agent — duplicate → 409 ─────────────────────────────────

  it('POST /invite-agent returns 409 when agent is already in the session', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const agent = await seedAgent(tdb.db, { slug: 'dupe-bot', tokenId: '7' });

    // Pre-seed session with this agent already in bots[]
    const botEntry: VoiceBotEntry = {
      agentDocId: agent._id,
      agentSlug: agent.slug,
      pid: 1111,
      invitedByUserId: new ObjectId(user.id),
      invitedAt: new Date(),
    };
    const session = await seedActiveSession(
      tdb.db,
      channel._id,
      channel.serverId,
      new ObjectId(user.id),
      [botEntry],
    );

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/invite-agent`,
      { sessionId: session._id.toHexString(), agentSlug: agent.slug },
      token,
    );

    expect(r.status).toBe(409);
    expect(r.body.error).toBe('agent_already_in_room');
  });

  // ── POST /kick-agent — happy path ─────────────────────────────────────────

  it('POST /kick-agent returns 200 with removed: true', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const agent = await seedAgent(tdb.db, { slug: 'kick-bot', tokenId: '5' });
    const botEntry: VoiceBotEntry = {
      agentDocId: agent._id,
      agentSlug: agent.slug,
      pid: 3333,
      invitedByUserId: new ObjectId(user.id),
      invitedAt: new Date(),
    };
    const session = await seedActiveSession(
      tdb.db,
      channel._id,
      channel.serverId,
      new ObjectId(user.id),
      [botEntry],
    );

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/kick-agent`,
      { sessionId: session._id.toHexString(), agentSlug: agent.slug },
      token,
    );

    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
  });

  // ── POST /kick-agent — session not found → 404 ───────────────────────────

  it('POST /kick-agent returns 404 when session does not exist', async () => {
    const fakeManager = makeFakeVoiceManager(tdb.db);
    const app = await makeVoiceApp(tdb.db, fakeManager);

    const { token, user } = await registerAndLogin(app);
    const channel = await seedChannel(tdb.db, { type: 'voice' });
    await addUserToServer(tdb.db, new ObjectId(user.id), channel.serverId);

    const r = await jsonReq(
      app,
      'POST',
      `/v1/channels/${channel._id.toHexString()}/voice/kick-agent`,
      { sessionId: new ObjectId().toHexString(), agentSlug: 'any-bot' },
      token,
    );

    expect(r.status).toBe(404);
    expect(r.body.error).toBe('session_not_found');
  });
});
