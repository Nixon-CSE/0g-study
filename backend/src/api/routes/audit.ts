import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireUser } from '../../auth/middleware.js';
import { findChannelById } from '../../channels/service.js';
import { collections, type AuditLogDoc, type ServerDoc } from '../../db/types.js';

export interface AuditRouteDeps {
  db: Db;
  jwtSecret: string;
}

export function auditRoutes(deps: AuditRouteDeps) {
  const app = new Hono();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.get('/v1/channels/:cid/audit', requireAuth, async (c) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) return c.json({ error: 'invalid_channel_id' }, 400);

    const channel = await findChannelById(deps.db, new ObjectId(cid));
    if (!channel) return c.json({ error: 'channel_not_found' }, 404);

    if (channel.type !== 'audit') return c.json({ error: 'not_audit_channel' }, 400);

    // Only the server owner may read the audit log.
    const user = c.get('user');
    const server = await deps.db.collection<ServerDoc>(collections.servers).findOne({ _id: channel.serverId });
    if (!server) return c.json({ error: 'server_not_found' }, 404);
    if (!server.ownerId.equals(user._id)) return c.json({ error: 'audit_owner_only' }, 403);

    const limitParam = c.req.query('limit');
    const limit = Math.min(limitParam ? parseInt(limitParam, 10) || 50 : 50, 200);
    const beforeParam = c.req.query('before');

    const filter: Record<string, unknown> = { serverId: channel.serverId };
    if (beforeParam) {
      const beforeDate = new Date(beforeParam);
      if (!isNaN(beforeDate.getTime())) {
        filter.createdAt = { $lt: beforeDate };
      }
    }

    const docs = await deps.db
      .collection<AuditLogDoc>(collections.auditLog)
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    const entries = docs.map((d) => ({
      id: d._id.toHexString(),
      action: d.action,
      actorType: d.actorType,
      agentSlug: d.agentSlug,
      payload: d.payload,
      createdAt: d.createdAt.toISOString(),
    }));

    return c.json({ entries });
  });

  return app;
}
