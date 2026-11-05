import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireUser, type AuthBindings } from '../../auth/middleware.js';
import { findMessageById, publicMessage } from '../../messages/service.js';
import { findMembership } from '../../servers/service.js';
import type { MessageDoc } from '../../db/types.js';
import { collections } from '../../db/types.js';

export interface CascadeRouteDeps { db: Db; jwtSecret: string; }

export function cascadeRoutes(deps: CascadeRouteDeps) {
  const app = new Hono<AuthBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.get('/v1/messages/:mid/cascade', requireAuth, async (c) => {
    const mid = c.req.param('mid');
    if (!ObjectId.isValid(mid)) return c.json({ error: 'invalid_message_id' }, 400);
    const root = await findMessageById(deps.db, new ObjectId(mid));
    if (!root) return c.json({ error: 'not_found' }, 404);

    // Permission: user must be a member of the channel's server.
    const member = await findMembership(deps.db, root.serverId, 'user', c.get('user')._id);
    if (!member) return c.json({ error: 'forbidden' }, 403);

    const rootId = root.cascadeRootId ?? root._id;
    const messages = await deps.db.collection<MessageDoc>(collections.messages)
      .find({ cascadeRootId: rootId })
      .sort({ createdAt: 1 })
      .toArray();
    return c.json({ messages: messages.map(publicMessage) });
  });

  return app;
}
