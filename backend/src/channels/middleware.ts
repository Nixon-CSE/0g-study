import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { findChannelById } from './service.js';
import { findMembership } from '../servers/service.js';
import type { ChannelDoc, MemberRole, ServerMemberDoc } from '../db/types.js';
import type { AuthBindings } from '../auth/middleware.js';

export interface ChannelBindings { Variables: AuthBindings['Variables'] & { channel: ChannelDoc; membership: ServerMemberDoc } }

const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 };

export function requireChannelAccess(db: Db, minRole: MemberRole = 'member'): MiddlewareHandler<ChannelBindings> {
  return async (c: Context, next: Next) => {
    const cid = c.req.param('cid');
    if (!cid || !ObjectId.isValid(cid)) return c.json({ error: 'invalid_channel_id' }, 400);
    const channel = await findChannelById(db, new ObjectId(cid));
    if (!channel) return c.json({ error: 'channel_not_found' }, 404);

    const user = c.get('user');
    const membership = await findMembership(db, channel.serverId, 'user', user._id);
    if (!membership) return c.json({ error: 'forbidden' }, 403);
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return c.json({ error: 'insufficient_role', required: minRole }, 403);
    }
    c.set('channel', channel);
    c.set('membership', membership);
    await next();
  };
}
