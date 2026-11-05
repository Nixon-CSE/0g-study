import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireAgentKey, type AgentKeyBindings } from '../../auth/agent-key-middleware.js';
import { findChannelById } from '../../channels/service.js';
import { findMembership, listServerMembers } from '../../servers/service.js';
import { findAgentByIdOrSlug } from '../../agents/registry.js';
import { findUserById } from '../../users/service.js';
import { listChannelMessages, publicMessage } from '../../messages/service.js';
import type { AgentDoc, UserDoc } from '../../db/types.js';

export interface InternalRouteDeps { db: Db; }

export function internalRoutes(deps: InternalRouteDeps) {
  const app = new Hono<AgentKeyBindings>();
  const guard = requireAgentKey(deps.db);

  app.get('/v1/internal/self', guard, (c) => {
    const a = c.get('agent');
    return c.json({ agent: { id: a._id.toHexString(), slug: a.slug, name: a.name } });
  });

  async function loadAuthorizedChannel(c: any) {
    const channelId = c.req.query('channelId');
    if (!channelId || !ObjectId.isValid(channelId)) {
      return { error: c.json({ error: 'invalid_channel_id' }, 400) };
    }
    const channel = await findChannelById(deps.db, new ObjectId(channelId));
    if (!channel) return { error: c.json({ error: 'channel_not_found' }, 404) };
    const agent = c.get('agent');
    const m = await findMembership(deps.db, channel.serverId, 'agent', agent._id);
    if (!m) return { error: c.json({ error: 'forbidden' }, 403) };
    return { channel };
  }

  app.get('/v1/internal/peers', guard, async (c) => {
    const r = await loadAuthorizedChannel(c);
    if ('error' in r) return r.error;
    const members = await listServerMembers(deps.db, r.channel.serverId);

    const agentIds = members.filter(m => m.principalType === 'agent').map(m => m.principalId);
    const userIds = members.filter(m => m.principalType === 'user').map(m => m.principalId);

    const [agents, users] = await Promise.all([
      Promise.all(agentIds.map(id => findAgentByIdOrSlug(deps.db, id.toHexString()))).then(xs => xs.filter(Boolean) as AgentDoc[]),
      Promise.all(userIds.map(id => findUserById(deps.db, id))).then(xs => xs.filter(Boolean) as UserDoc[]),
    ]);

    return c.json({
      agents: agents.map(a => ({ id: a._id.toHexString(), slug: a.slug, name: a.name, description: a.description, tags: a.tags })),
      users: users.map(u => ({ id: u._id.toHexString(), username: u.username, displayName: u.displayName })),
    });
  });

  app.get('/v1/internal/channel-history', guard, async (c) => {
    const r = await loadAuthorizedChannel(c);
    if ('error' in r) return r.error;
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : 50;
    const { messages, nextCursor } = await listChannelMessages(deps.db, r.channel._id, { limit, before: null });
    return c.json({ messages: messages.map(publicMessage), nextCursor });
  });

  return app;
}
