import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { stream } from 'hono/streaming';
import { requireUser } from '../../auth/middleware.js';
import { requireChannelAccess, type ChannelBindings } from '../../channels/middleware.js';
import { resolveMentions } from '../../messages/mentions.js';
import {
  insertMessage, listChannelMessages, findMessageById, deleteMessage, publicMessage,
} from '../../messages/service.js';
import { computeInvocationSet, startStreamingInvocation, runCascade } from '../../agents/invoker.js';
import { collections } from '../../db/types.js';
import type { ServerDoc, UserDoc } from '../../db/types.js';
import { takeStream } from '../../messages/stream-registry.js';
import { sseChunks } from '../../agents/client.js';
import { log } from '../../util/logger.js';
import { findMembership } from '../../servers/service.js';

const PostMessageBody = z.object({
  content: z.string().min(1).max(4000),
  replyToId: z.string().regex(/^[a-f0-9]{24}$/).nullish(),
  stream: z.boolean().optional(),
});

export interface MessageRouteDeps {
  db: Db;
  jwtSecret: string;
  cascadeConfig?: { maxHops?: number; maxInvocationsPerRoot?: number };
  inftDeps?: import('../../agents/invoker.js').InftDeps;
}

export function messageRoutes(deps: MessageRouteDeps) {
  const app = new Hono<ChannelBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.post('/v1/channels/:cid/messages', requireAuth, requireChannelAccess(deps.db), async (c) => {
    const parsed = PostMessageBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    const channel = c.get('channel');
    const user = c.get('user');
    const mentions = await resolveMentions(deps.db, channel.serverId, parsed.data.content);

    const userMessage = await insertMessage(deps.db, {
      channelId: channel._id,
      serverId: channel.serverId,
      authorType: 'user',
      authorId: user._id,
      content: parsed.data.content,
      mentions,
      replyToId: parsed.data.replyToId ? new ObjectId(parsed.data.replyToId) : null,
    });

    // Backfill cascade metadata on the root user message.
    await deps.db.collection(collections.messages).updateOne(
      { _id: userMessage._id },
      { $set: { cascadeRootId: userMessage._id, cascadeHop: 0, parentMessageId: null } }
    );
    const userMsgWithMeta = await deps.db.collection(collections.messages).findOne({ _id: userMessage._id });

    // Fetch the server once so both paths can pass the wallet key as envOverride.
    const server = await deps.db.collection<ServerDoc>(collections.servers).findOne({ _id: channel.serverId });

    const serverWallet = server?.wallet?.address;

    if (parsed.data.stream) {
      // Streaming path remains single-hop in v1.
      const agents = await computeInvocationSet({ db: deps.db, channel, userMessage });
      const envOverride = server?.wallet?.privateKey
        ? { DEPLOYER_PRIVATE_KEY: server.wallet.privateKey }
        : undefined;
      const handles = await startStreamingInvocation(
        { db: deps.db, channel, userMessage, inftDeps: deps.inftDeps, serverWallet },
        agents,
        envOverride,
      );
      return c.json({
        userMessage: publicMessage(userMsgWithMeta as any),
        replies: [],
        streamIds: handles.map(h => h.streamId),
      }, 201);
    }

    const replies = await runCascade({
      db: deps.db,
      channel,
      rootMessage: userMsgWithMeta as any,
      config: deps.cascadeConfig,
      server: server ?? undefined,
      inftDeps: deps.inftDeps,
    });
    return c.json({
      userMessage: publicMessage(userMsgWithMeta as any),
      replies: replies.map(publicMessage),
    }, 201);
  });

  app.get('/v1/channels/:cid/stream/:streamId', requireAuth, requireChannelAccess(deps.db), async (c) => {
    const streamId = c.req.param('streamId');
    const pending = takeStream(streamId);
    if (!pending) return c.json({ error: 'stream_not_found_or_expired' }, 404);
    if (!pending.channel._id.equals(c.get('channel')._id)) {
      return c.json({ error: 'stream_not_in_this_channel' }, 403);
    }

    return stream(c, async (s) => {
      const upstream = await fetch(pending.upstreamUrl);
      if (!upstream.ok || !upstream.body) {
        s.write(`event: error\ndata: ${JSON.stringify({ status: upstream.status })}\n\n`);
        return;
      }
      let finalText = '';
      try {
        for await (const chunk of sseChunks(upstream.body)) {
          finalText += chunk;
          s.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }
      } finally {
        try { await pending.onClose(finalText); }
        catch (e) { log.warn({ err: e }, 'persist final stream message failed'); }
        s.write(`event: done\ndata: {}\n\n`);
      }
    });
  });

  app.get('/v1/channels/:cid/messages', requireAuth, requireChannelAccess(deps.db), async (c) => {
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
    const beforeStr = c.req.query('before');
    const before = beforeStr && ObjectId.isValid(beforeStr) ? new ObjectId(beforeStr) : null;
    const { messages, nextCursor } = await listChannelMessages(deps.db, c.get('channel')._id, { limit, before });

    const userIds = [...new Set(
      messages.filter(m => m.authorType === 'user').map(m => m.authorId),
    )];
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await deps.db.collection<UserDoc>(collections.users)
        .find({ _id: { $in: userIds } }, { projection: { displayName: 1, username: 1 } })
        .toArray();
      for (const u of users) {
        nameMap.set(u._id.toHexString(), u.displayName || u.username);
      }
    }

    return c.json({
      messages: messages.map(m => ({
        ...publicMessage(m),
        authorName: m.authorType === 'user' ? (nameMap.get(m.authorId.toHexString()) ?? null) : null,
      })),
      nextCursor,
    });
  });

  app.delete('/v1/messages/:mid', requireAuth, async (c) => {
    const mid = c.req.param('mid');
    if (!ObjectId.isValid(mid)) return c.json({ error: 'invalid_message_id' }, 400);
    const msg = await findMessageById(deps.db, new ObjectId(mid));
    if (!msg) return c.json({ error: 'not_found' }, 404);

    const user = c.get('user');
    const isAuthor = msg.authorType === 'user' && msg.authorId.equals(user._id);
    if (!isAuthor) {
      const m = await findMembership(deps.db, msg.serverId, 'user', user._id);
      if (!m || (m.role !== 'owner' && m.role !== 'admin')) {
        return c.json({ error: 'forbidden' }, 403);
      }
    }
    await deleteMessage(deps.db, msg._id);
    return c.json({ ok: true });
  });

  return app;
}
