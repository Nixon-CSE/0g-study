import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireUser } from '../../auth/middleware.js';
import { requireServerMember, type ServerBindings } from '../../servers/middleware.js';
import { requireChannelAccess, type ChannelBindings } from '../../channels/middleware.js';
import { findMembership } from '../../servers/service.js';
import { ChannelNameTakenError, createChannel, publicChannel } from '../../channels/service.js';
import { collections } from '../../db/types.js';

const CHANNEL_NAME_RE = /^[a-z0-9_-]{1,64}$/;

const CreateChannelBody = z.object({
  name: z.string().regex(CHANNEL_NAME_RE, 'channel name must match /^[a-z0-9_-]{1,64}$/'),
  topic: z.string().max(256).nullish(),
  defaultAgentId: z.string().regex(/^[a-f0-9]{24}$/).nullish(),
  position: z.number().int().nonnegative().optional(),
  /** When true, mark this channel as TEE-attested (private). */
  tee: z.boolean().optional(),
});

const PatchChannelBody = z.object({
  name: z.string().regex(CHANNEL_NAME_RE).optional(),
  topic: z.string().max(256).nullable().optional(),
  defaultAgentId: z.string().regex(/^[a-f0-9]{24}$/).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
  cascadeEnabled: z.boolean().optional(),
});

export interface ChannelRouteDeps { db: Db; jwtSecret: string; }

async function assertAgentIsMember(db: Db, serverId: ObjectId, agentId: ObjectId): Promise<boolean> {
  const m = await findMembership(db, serverId, 'agent', agentId);
  return m !== null;
}

export function channelRoutes(deps: ChannelRouteDeps) {
  const app = new Hono<ServerBindings & ChannelBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.post('/v1/servers/:sid/channels', requireAuth, requireServerMember(deps.db, 'admin'), async (c) => {
    const parsed = CreateChannelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    let defaultAgentId: ObjectId | null = null;
    if (parsed.data.defaultAgentId) {
      const aid = new ObjectId(parsed.data.defaultAgentId);
      if (!(await assertAgentIsMember(deps.db, c.get('server')._id, aid))) {
        return c.json({ error: 'agent_not_a_member' }, 400);
      }
      defaultAgentId = aid;
    }

    try {
      const ch = await createChannel(deps.db, {
        serverId: c.get('server')._id,
        name: parsed.data.name,
        topic: parsed.data.topic ?? null,
        defaultAgentId,
        position: parsed.data.position,
        tee: parsed.data.tee,
      });
      return c.json({ channel: publicChannel(ch) }, 201);
    } catch (e) {
      if (e instanceof ChannelNameTakenError) return c.json({ error: 'channel_name_taken' }, 409);
      throw e;
    }
  });

  app.get('/v1/channels/:cid', requireAuth, requireChannelAccess(deps.db), (c) => {
    return c.json({ channel: publicChannel(c.get('channel')) });
  });

  app.patch('/v1/channels/:cid', requireAuth, requireChannelAccess(deps.db, 'admin'), async (c) => {
    const parsed = PatchChannelBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const $set: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) $set.name = parsed.data.name.toLowerCase();
    if (parsed.data.topic !== undefined) $set.topic = parsed.data.topic;
    if (parsed.data.position !== undefined) $set.position = parsed.data.position;
    if (parsed.data.defaultAgentId !== undefined) {
      if (parsed.data.defaultAgentId === null) {
        $set.defaultAgentId = null;
      } else {
        const aid = new ObjectId(parsed.data.defaultAgentId);
        if (!(await assertAgentIsMember(deps.db, c.get('channel').serverId, aid))) {
          return c.json({ error: 'agent_not_a_member' }, 400);
        }
        $set.defaultAgentId = aid;
      }
    }
    if (parsed.data.cascadeEnabled !== undefined) $set.cascadeEnabled = parsed.data.cascadeEnabled;
    const updated = await deps.db.collection(collections.channels).findOneAndUpdate(
      { _id: c.get('channel')._id }, { $set }, { returnDocument: 'after' }
    );
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ channel: publicChannel(updated as any) });
  });

  app.delete('/v1/channels/:cid', requireAuth, requireChannelAccess(deps.db, 'admin'), async (c) => {
    const cid = c.get('channel')._id;
    await deps.db.collection(collections.messages).deleteMany({ channelId: cid });
    await deps.db.collection(collections.channels).deleteOne({ _id: cid });
    return c.json({ ok: true });
  });

  return app;
}
