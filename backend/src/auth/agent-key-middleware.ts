import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Db } from 'mongodb';
import { findAgentByKeyHash, hashAgentKey } from '../agents/registry.js';
import type { AgentDoc } from '../db/types.js';

export interface AgentKeyBindings { Variables: { agent: AgentDoc } }

export function requireAgentKey(db: Db): MiddlewareHandler<AgentKeyBindings> {
  return async (c: Context, next: Next) => {
    const key = c.req.header('x-bonfire-agent-key');
    if (!key || !key.startsWith('bka_')) {
      return c.json({ error: 'missing or malformed agent key' }, 401);
    }
    const hash = hashAgentKey(key);
    const agent = await findAgentByKeyHash(db, hash);
    if (!agent) return c.json({ error: 'invalid agent key' }, 401);
    c.set('agent', agent);
    await next();
  };
}
