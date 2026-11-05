/**
 * Voice channel HTTP routes.
 *
 *  POST  /v1/channels/:cid/voice/join
 *  POST  /v1/channels/:cid/voice/leave
 *  POST  /v1/channels/:cid/voice/invite-agent
 *  POST  /v1/channels/:cid/voice/kick-agent
 *  GET   /v1/channels/:cid/voice/status
 */

import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { z } from 'zod';
import { requireUser } from '../../auth/middleware.js';
import type { AuthBindings } from '../../auth/middleware.js';
import { findChannelById } from '../../channels/service.js';
import type { VoiceManager } from '../../voice/manager.js';
import { BotSpawnError, AgentAlreadyInvitedError } from '../../voice/manager.js';
import type { AgentDoc, VoiceSessionDoc } from '../../db/types.js';
import { collections } from '../../db/types.js';
import { log } from '../../util/logger.js';

export interface VoiceRouteDeps {
  db: Db;
  jwtSecret: string;
  voiceManager: VoiceManager;
}

const LeaveBody = z.object({
  sessionId: z.string().regex(/^[a-f0-9]{24}$/),
});

const InviteAgentBody = z.object({
  sessionId: z.string().regex(/^[a-f0-9]{24}$/),
  agentSlug: z.string().min(1),
});

const KickAgentBody = z.object({
  sessionId: z.string().regex(/^[a-f0-9]{24}$/),
  agentSlug: z.string().min(1),
});

export function voiceRoutes(deps: VoiceRouteDeps) {
  const app = new Hono<AuthBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  // ── POST /v1/channels/:cid/voice/join ───────────────────────────────────────

  app.post('/v1/channels/:cid/voice/join', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) {
      return c.json({ error: 'invalid_channel_id' }, 400);
    }

    const channel = await findChannelById(deps.db, new ObjectId(cid));
    if (!channel) return c.json({ error: 'channel_not_found' }, 404);

    if (channel.type !== 'voice') {
      return c.json({ error: 'channel_not_voice' }, 409);
    }

    const user = c.get('user');

    try {
      const { session, userToken } = await deps.voiceManager.joinChannel({ channel, user });
      return c.json({
        roomUrl: session.dailyRoomUrl,
        token: userToken,
        sessionId: session._id.toHexString(),
        // Legacy field — kept for clients that still read it; null on new sessions
        agentSlug: session.agentSlug ?? null,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (e) {
      if (e instanceof BotSpawnError) {
        log.warn({ err: e, cid }, 'bot spawn failed on join');
        return c.json({ error: 'bot_spawn_failed' }, 503);
      }
      throw e;
    }
  });

  // ── POST /v1/channels/:cid/voice/leave ──────────────────────────────────────

  app.post('/v1/channels/:cid/voice/leave', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) {
      return c.json({ error: 'invalid_channel_id' }, 400);
    }

    const parsed = LeaveBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }

    const user = c.get('user');
    const sessionId = new ObjectId(parsed.data.sessionId);

    const { ended } = await deps.voiceManager.leaveChannel({ sessionId, user });
    return c.json({ ok: true, ended });
  });

  // ── POST /v1/channels/:cid/voice/invite-agent ───────────────────────────────

  app.post('/v1/channels/:cid/voice/invite-agent', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) {
      return c.json({ error: 'invalid_channel_id' }, 400);
    }

    const parsed = InviteAgentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }

    const { sessionId: sessionIdHex, agentSlug } = parsed.data;
    const user = c.get('user');

    // Look up session — must be active and belong to this channel.
    const session = await deps.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({
        _id: new ObjectId(sessionIdHex),
        channelId: new ObjectId(cid),
        status: { $in: ['starting', 'active'] },
      });

    if (!session) {
      return c.json({ error: 'session_not_found' }, 404);
    }

    // Look up agent by slug.
    const agent = await deps.db
      .collection<AgentDoc>(collections.agents)
      .findOne({ slug: agentSlug });

    if (!agent) {
      return c.json({ error: 'agent_not_found' }, 404);
    }

    // Only INFT-backed agents (those with a tokenId) can be invited.
    if (!agent.tokenId) {
      return c.json({ error: 'agent_not_invitable' }, 400);
    }

    // Guard: duplicate invite — checked here for an early HTTP response; the
    // manager also enforces this to avoid a TOCTOU race.
    const bots = session.bots ?? [];
    if (bots.some((b) => b.agentSlug === agentSlug)) {
      return c.json({ error: 'agent_already_in_room' }, 409);
    }

    try {
      const { bot } = await deps.voiceManager.inviteAgent({ session, agent, invitedBy: user });
      return c.json({
        bot: {
          agentSlug: bot.agentSlug,
          agentDocId: bot.agentDocId.toHexString(),
          invitedAt: bot.invitedAt.toISOString(),
        },
      });
    } catch (e) {
      if (e instanceof AgentAlreadyInvitedError) {
        return c.json({ error: 'agent_already_in_room' }, 409);
      }
      if (e instanceof BotSpawnError) {
        log.warn({ err: e, cid, agentSlug }, 'bot spawn failed on invite');
        return c.json({ error: 'bot_spawn_failed' }, 503);
      }
      throw e;
    }
  });

  // ── POST /v1/channels/:cid/voice/kick-agent ──────────────────────────────────

  app.post('/v1/channels/:cid/voice/kick-agent', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) {
      return c.json({ error: 'invalid_channel_id' }, 400);
    }

    const parsed = KickAgentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }

    const { sessionId: sessionIdHex, agentSlug } = parsed.data;
    const user = c.get('user');

    const session = await deps.db
      .collection<VoiceSessionDoc>(collections.voiceSessions)
      .findOne({
        _id: new ObjectId(sessionIdHex),
        channelId: new ObjectId(cid),
        status: { $in: ['starting', 'active'] },
      });

    if (!session) {
      return c.json({ error: 'session_not_found' }, 404);
    }

    const { removed } = await deps.voiceManager.kickAgent({ session, agentSlug, requestedBy: user });
    if (!removed) {
      return c.json({ error: 'agent_not_in_room' }, 404);
    }

    return c.json({ removed: true });
  });

  // ── GET /v1/channels/:cid/voice/status ──────────────────────────────────────

  app.get('/v1/channels/:cid/voice/status', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) {
      return c.json({ error: 'invalid_channel_id' }, 400);
    }

    const session = await deps.voiceManager.status(new ObjectId(cid));
    if (!session) {
      return c.json({ active: false });
    }

    const bots = (session.bots ?? []).map((b) => ({
      agentSlug: b.agentSlug,
      agentDocId: b.agentDocId.toHexString(),
      invitedAt: b.invitedAt.toISOString(),
    }));

    return c.json({
      active: true,
      sessionId: session._id.toHexString(),
      participantCount: session.participantIds.length,
      expiresAt: session.expiresAt.toISOString(),
      bots,
    });
  });

  return app;
}
