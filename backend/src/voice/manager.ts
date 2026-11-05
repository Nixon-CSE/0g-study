/**
 * VoiceManager — multi-bot session lifecycle.
 *
 * Design: join creates/reuses a Daily room but spawns NO bot. Users then
 * explicitly invite agents via `inviteAgent`, each of which runs its own
 * Pipecat subprocess. `kickAgent` terminates a single bot. When the last human
 * leaves, all remaining bots are killed before tearing down the room.
 *
 * Backwards compat: old VoiceSessionDoc rows without `bots` are treated as
 * `bots: []` everywhere. The legacy `pythonPid` / `agentSlug` / `agentSoul`
 * fields are preserved on existing rows and never overwritten.
 */

import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import type { DailyClient } from './daily-client.js';
import type { OgStorageClient } from '../storage-0g/index.js';
import type { ChannelDoc, UserDoc, VoiceSessionDoc, AgentDoc, VoiceBotEntry } from '../db/types.js';
import { collections } from '../db/types.js';
import { decryptAgentBundle } from '../agents/inft-decrypt.js';
import { writeAudit } from '../audit/log.js';
import { log } from '../util/logger.js';

export interface VoiceManagerDeps {
  db: Db;
  daily: DailyClient;
  /** Present when INFT integration is enabled. */
  storage?: OgStorageClient;
  platformExecutorPrivkey?: string;
  spawnBot: (env: Record<string, string>) => { pid: number; kill: () => void };
}

export class BotSpawnError extends Error {
  code = 'bot_spawn_failed' as const;
}

export class AgentAlreadyInvitedError extends Error {
  code = 'agent_already_in_room' as const;
}

/**
 * Returns session.bots safely, defaulting to [] for legacy rows that pre-date
 * the multi-bot schema addition.
 */
function safeBots(session: VoiceSessionDoc): VoiceBotEntry[] {
  return session.bots ?? [];
}

export class VoiceManager {
  private readonly db: Db;
  private readonly daily: DailyClient;
  private readonly storage?: OgStorageClient;
  private readonly platformExecutorPrivkey?: string;
  private readonly spawnBot: VoiceManagerDeps['spawnBot'];

  /**
   * In-memory kill-function registry. Key format:
   *   `<sessionId-hex>:<agentSlug>` for per-bot entries
   * This keeps per-agent cleanup O(1) and avoids a full-scan on kick.
   */
  private readonly botKills = new Map<string, { kill: () => void }>();

  constructor(deps: VoiceManagerDeps) {
    this.db = deps.db;
    this.daily = deps.daily;
    this.storage = deps.storage;
    this.platformExecutorPrivkey = deps.platformExecutorPrivkey;
    this.spawnBot = deps.spawnBot;
  }

  // ── joinChannel ─────────────────────────────────────────────────────────────
  /**
   * Join a voice channel. Creates a new Daily room (if no active session exists)
   * or reuses an existing one. Does NOT spawn any bot — bots are added via
   * `inviteAgent` after joining.
   *
   * @param opts.channel - The voice channel to join.
   * @param opts.user    - The user joining.
   * @returns session doc and a short-lived Daily meeting token for the user.
   */
  async joinChannel(opts: {
    channel: ChannelDoc;
    user: UserDoc;
  }): Promise<{ session: VoiceSessionDoc; userToken: string }> {
    const { channel, user } = opts;
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    // Get-or-create: find an active session for this channel.
    const existing = await col.findOne({
      channelId: channel._id,
      status: { $in: ['starting', 'active'] },
      expiresAt: { $gt: new Date() },
    });

    if (existing) {
      // Add user to existing session (idempotent on duplicate).
      await col.updateOne(
        { _id: existing._id },
        { $addToSet: { participantIds: user._id } },
      );

      const userToken = await this.daily.mintMeetingToken({
        roomName: existing.dailyRoomName,
        userName: user.username,
        isOwner: false,
        expSeconds: Math.max(
          60,
          Math.floor((existing.expiresAt.getTime() - Date.now()) / 1000),
        ),
      });

      const session = (await col.findOne({ _id: existing._id }))!;
      await writeAudit(this.db, {
        serverId: channel.serverId,
        channelId: channel._id,
        actorType: 'user',
        actorId: user._id,
        agentId: null,
        agentSlug: null,
        action: 'voice_join',
        payload: { sessionId: session._id.toHexString(), reused: true },
      });
      return { session, userToken };
    }

    // ── Create a new session (no bot spawned) ──────────────────────────────

    const room = await this.daily.createRoom({ expSeconds: 600 });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    const sessionDoc: VoiceSessionDoc = {
      _id: new ObjectId(),
      channelId: channel._id,
      serverId: channel.serverId,
      dailyRoomName: room.name,
      dailyRoomUrl: room.url,
      participantIds: [user._id],
      status: 'active',
      startedAt: now,
      expiresAt,
      endedAt: null,
      bots: [],
    };

    await col.insertOne(sessionDoc);

    const userToken = await this.daily.mintMeetingToken({
      roomName: room.name,
      userName: user.username,
      isOwner: false,
      expSeconds: 600,
    });

    await writeAudit(this.db, {
      serverId: channel.serverId,
      channelId: channel._id,
      actorType: 'user',
      actorId: user._id,
      agentId: null,
      agentSlug: null,
      action: 'voice_join',
      payload: {
        sessionId: sessionDoc._id.toHexString(),
        reused: false,
        roomName: room.name,
      },
    });

    return { session: sessionDoc, userToken };
  }

  // ── inviteAgent ──────────────────────────────────────────────────────────────
  /**
   * Invite an INFT-backed agent into an active session. Decrypts the agent's
   * bundle, mints a bot token, spawns a Pipecat subprocess, and appends a
   * VoiceBotEntry to the session doc.
   *
   * @param opts.session    - The active VoiceSessionDoc.
   * @param opts.agent      - The AgentDoc to invite (must have tokenId).
   * @param opts.invitedBy  - The user performing the invite.
   * @returns The new VoiceBotEntry.
   * @throws AgentAlreadyInvitedError if the agent's slug is already in bots[].
   * @throws BotSpawnError if the subprocess cannot be started.
   */
  async inviteAgent(opts: {
    session: VoiceSessionDoc;
    agent: AgentDoc;
    invitedBy: UserDoc;
  }): Promise<{ bot: VoiceBotEntry }> {
    const { session, agent, invitedBy } = opts;
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    const existingBots = safeBots(session);
    if (existingBots.some((b) => b.agentSlug === agent.slug)) {
      throw new AgentAlreadyInvitedError(`agent ${agent.slug} is already in this session`);
    }

    // Decrypt agent bundle to get its SOUL and operating rules (AGENTS.md).
    // Both feed the voice bot's system prompt — same shape as text chat.
    let agentSoul = '';
    let agentRules = '';
    if (agent.tokenId && this.storage && this.platformExecutorPrivkey) {
      try {
        const bundle = await decryptAgentBundle({
          agent,
          storage: this.storage,
          platformExecutorPrivkey: this.platformExecutorPrivkey,
        });
        agentSoul = bundle.soul ?? '';
        agentRules = bundle.agents ?? '';
      } catch (e) {
        log.warn({ agentSlug: agent.slug, err: e }, 'failed to decrypt agent bundle; using empty soul/rules');
      }
    }

    // Look up the room's server wallet — voice LLM inference will be billed
    // against it (mirrors the text-chat envOverride.DEPLOYER_PRIVATE_KEY path).
    // Falls back to env OG_LLM_API_KEY only if the server has no wallet on
    // record (legacy rows / safety net).
    type ServerWithWallet = { wallet?: { privateKey?: string } };
    const serverDoc = await this.db
      .collection<ServerWithWallet>('servers')
      .findOne({ _id: session.serverId });
    const serverWalletKey = serverDoc?.wallet?.privateKey ?? '';
    if (!serverWalletKey) {
      log.warn(
        { serverId: session.serverId.toHexString(), agentSlug: agent.slug },
        'voice invite: server has no wallet; voice LLM will use platform fallback wallet',
      );
    }

    // Mint a bot meeting token (owner-level so it can mute/kick others).
    const botToken = await this.daily.mintMeetingToken({
      roomName: session.dailyRoomName,
      userName: agent.name,
      isOwner: true,
      expSeconds: Math.max(
        60,
        Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
      ),
    });

    const botEnv: Record<string, string> = {
      DAILY_ROOM_URL: session.dailyRoomUrl,
      DAILY_BOT_TOKEN: botToken,
      AGENT_SOUL: agentSoul,
      AGENT_AGENTS: agentRules,
      AGENT_SLUG: agent.slug,
      AGENT_NAME: agent.name,
      OG_LLM_BASE_URL: process.env.OG_LLM_BASE_URL ?? '',
      // Pipecat's OpenAILLMService sends this as `Authorization: Bearer <key>`.
      // The 0G LLM proxy reads it back and uses it as the wallet for broker
      // signing — so each voice room's inference is billed to that room's
      // server wallet. Empty string ⇒ proxy falls back to its env wallet.
      OG_LLM_API_KEY: serverWalletKey || process.env.OG_LLM_API_KEY || '',
      OG_LLM_MODEL: process.env.OG_LLM_MODEL ?? '',
      DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY ?? '',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      OPENAI_TTS_VOICE: process.env.OPENAI_TTS_VOICE ?? 'nova',
      OPENAI_TTS_MODEL: process.env.OPENAI_TTS_MODEL ?? 'tts-1',
    };

    let spawned: { pid: number; kill: () => void };
    try {
      spawned = this.spawnBot(botEnv);
    } catch (e) {
      log.error({ err: e, agentSlug: agent.slug }, 'bot spawn failed for invited agent');
      throw new BotSpawnError(`bot spawn failed for ${agent.slug}: ${String(e)}`);
    }

    const botEntry: VoiceBotEntry = {
      agentDocId: agent._id,
      agentSlug: agent.slug,
      pid: spawned.pid,
      invitedByUserId: invitedBy._id,
      invitedAt: new Date(),
    };

    // Register kill callback keyed by session+slug so kickAgent can find it.
    const killKey = `${session._id.toHexString()}:${agent.slug}`;
    this.botKills.set(killKey, { kill: spawned.kill });

    // Persist the new bot entry atomically.
    await col.updateOne(
      { _id: session._id },
      { $push: { bots: botEntry } as any },
    );

    log.info(
      { sessionId: session._id.toHexString(), agentSlug: agent.slug, pid: spawned.pid },
      'invited agent bot spawned',
    );

    await writeAudit(this.db, {
      serverId: session.serverId,
      channelId: session.channelId,
      actorType: 'user',
      actorId: invitedBy._id,
      agentId: agent._id,
      agentSlug: agent.slug,
      action: 'voice_agent_invited',
      payload: {
        sessionId: session._id.toHexString(),
        pid: spawned.pid,
      },
    });

    return { bot: botEntry };
  }

  // ── kickAgent ────────────────────────────────────────────────────────────────
  /**
   * Remove a specific bot from an active session by agent slug. Sends SIGTERM
   * via the in-memory kill registry and removes the entry from bots[].
   *
   * @param opts.session      - The active VoiceSessionDoc.
   * @param opts.agentSlug    - Slug of the agent to remove.
   * @param opts.requestedBy  - User performing the kick (reserved for future ACL).
   * @returns `{ removed: true }` if the bot was found and killed; `{ removed: false }` otherwise.
   */
  async kickAgent(opts: {
    session: VoiceSessionDoc;
    agentSlug: string;
    requestedBy: UserDoc;
  }): Promise<{ removed: boolean }> {
    const { session, agentSlug } = opts;
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    const existingBots = safeBots(session);
    const target = existingBots.find((b) => b.agentSlug === agentSlug);
    if (!target) return { removed: false };

    const killKey = `${session._id.toHexString()}:${agentSlug}`;
    const entry = this.botKills.get(killKey);
    if (entry) {
      try { entry.kill(); } catch { /* subprocess may have already exited */ }
      this.botKills.delete(killKey);
    }

    await col.updateOne(
      { _id: session._id },
      { $pull: { bots: { agentSlug } } as any },
    );

    log.info({ sessionId: session._id.toHexString(), agentSlug }, 'agent bot kicked');

    await writeAudit(this.db, {
      serverId: session.serverId,
      channelId: session.channelId,
      actorType: 'user',
      actorId: opts.requestedBy._id,
      agentId: target.agentDocId,
      agentSlug,
      action: 'voice_agent_kicked',
      payload: { sessionId: session._id.toHexString() },
    });

    return { removed: true };
  }

  // ── leaveChannel ─────────────────────────────────────────────────────────────
  /**
   * Remove a user from an active session. When the last participant leaves:
   * - If bots are present they are all killed first, then the room is torn down.
   * - If no bots remain, the room is torn down immediately.
   *
   * @param opts.sessionId - The session to leave.
   * @param opts.user      - The user leaving.
   * @returns `{ ended: true }` when the session was torn down.
   */
  async leaveChannel(opts: {
    sessionId: ObjectId;
    user: UserDoc;
  }): Promise<{ ended: boolean }> {
    const { sessionId, user } = opts;
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    await col.updateOne(
      { _id: sessionId },
      { $pull: { participantIds: user._id } },
    );

    const session = await col.findOne({ _id: sessionId });
    if (!session || session.status === 'ended') return { ended: true };

    if (session.participantIds.length === 0) {
      // Kill all remaining bots before tearing down.
      const bots = safeBots(session);
      for (const bot of bots) {
        const killKey = `${sessionId.toHexString()}:${bot.agentSlug}`;
        const entry = this.botKills.get(killKey);
        if (entry) {
          try { entry.kill(); } catch { /* ignore */ }
          this.botKills.delete(killKey);
        }
      }
      await this._teardown(session);
      await writeAudit(this.db, {
        serverId: session.serverId,
        channelId: session.channelId,
        actorType: 'user',
        actorId: user._id,
        agentId: null,
        agentSlug: null,
        action: 'voice_leave',
        payload: {
          sessionId: session._id.toHexString(),
          ended: true,
          botsKilled: bots.length,
        },
      });
      return { ended: true };
    }

    await writeAudit(this.db, {
      serverId: session.serverId,
      channelId: session.channelId,
      actorType: 'user',
      actorId: user._id,
      agentId: null,
      agentSlug: null,
      action: 'voice_leave',
      payload: {
        sessionId: session._id.toHexString(),
        ended: false,
        remainingParticipants: session.participantIds.length,
      },
    });
    return { ended: false };
  }

  // ── status ───────────────────────────────────────────────────────────────────

  /**
   * Return the active VoiceSessionDoc for a channel, or null if none exists.
   *
   * @param channelId - The channel to query.
   */
  async status(channelId: ObjectId): Promise<VoiceSessionDoc | null> {
    const session = await this.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({
        channelId,
        status: { $in: ['starting', 'active'] },
        expiresAt: { $gt: new Date() },
      });
    if (!session) return null;
    // Normalise legacy rows that pre-date the bots field.
    if (!session.bots) session.bots = [];
    return session;
  }

  // ── sweep ────────────────────────────────────────────────────────────────────

  /**
   * Expire stale sessions whose `expiresAt` is in the past. Kills all bots in
   * each stale session before deletion.
   *
   * @returns Number of sessions torn down.
   */
  async sweep(): Promise<number> {
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);
    const stale = await col
      .find({
        status: { $in: ['starting', 'active'] },
        expiresAt: { $lte: new Date() },
      })
      .toArray();

    let count = 0;
    for (const session of stale) {
      try {
        // Kill all bots for this session before tearing down the room.
        const bots = safeBots(session);
        for (const bot of bots) {
          const killKey = `${session._id.toHexString()}:${bot.agentSlug}`;
          const entry = this.botKills.get(killKey);
          if (entry) {
            try { entry.kill(); } catch { /* ignore */ }
            this.botKills.delete(killKey);
          }
        }
        await this._teardown(session);
        count++;
      } catch (e) {
        log.warn({ err: e, sessionId: session._id.toHexString() }, 'sweep teardown failed');
      }
    }

    if (count > 0) log.info({ count }, 'voice sweeper expired sessions');
    return count;
  }

  // ── shutdown ─────────────────────────────────────────────────────────────────

  /**
   * Kill all tracked bots across all sessions. Called on process shutdown.
   */
  async shutdown(): Promise<void> {
    log.info({ count: this.botKills.size }, 'voice manager shutdown: killing all bots');
    for (const [, entry] of this.botKills) {
      try { entry.kill(); } catch { /* ignore */ }
    }
    this.botKills.clear();
  }

  // ── private teardown ─────────────────────────────────────────────────────────

  private async _teardown(session: VoiceSessionDoc): Promise<void> {
    const col = this.db.collection<VoiceSessionDoc>(collections.voiceSessions);

    // Delete Daily room
    await this.daily.deleteRoom(session.dailyRoomName).catch((e) =>
      log.warn({ err: e, room: session.dailyRoomName }, 'deleteRoom failed during teardown'),
    );

    // Mark ended
    await col.updateOne(
      { _id: session._id },
      { $set: { status: 'ended', endedAt: new Date() } },
    );
  }
}
