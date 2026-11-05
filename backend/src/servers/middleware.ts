import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Db } from 'mongodb';
import { findServerByIdOrSlug, findMembership } from './service.js';
import type { ServerDoc, ServerMemberDoc, MemberRole } from '../db/types.js';
import type { AuthBindings } from '../auth/middleware.js';

export interface ServerBindings { Variables: AuthBindings['Variables'] & { server: ServerDoc; membership: ServerMemberDoc } }

const ROLE_RANK: Record<MemberRole, number> = { member: 0, admin: 1, owner: 2 };

export function requireServerMember(db: Db, minRole: MemberRole = 'member'): MiddlewareHandler<ServerBindings> {
  return async (c: Context, next: Next) => {
    const sid = c.req.param('sid');
    if (!sid) return c.json({ error: 'missing_server_id' }, 400);
    const server = await findServerByIdOrSlug(db, sid);
    if (!server) return c.json({ error: 'server_not_found' }, 404);

    const user = c.get('user');
    const membership = await findMembership(db, server._id, 'user', user._id);
    if (!membership) return c.json({ error: 'forbidden' }, 403);
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return c.json({ error: 'insufficient_role', required: minRole }, 403);
    }
    c.set('server', server);
    c.set('membership', membership);
    await next();
  };
}
