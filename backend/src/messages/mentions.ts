import type { Db, ObjectId } from 'mongodb';
import type { MessageMention, ServerMemberDoc, UserDoc, AgentDoc } from '../db/types.js';
import { collections } from '../db/types.js';

const MENTION_RE = /@([a-z0-9_-]{3,32})/gi;
const ci = { locale: 'en', strength: 2 } as const;

export function extractHandles(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) out.add(m[1].toLowerCase());
  return [...out];
}

/**
 * Resolve `@<handle>` tokens in a message.
 *
 * Users are still scoped to the channel's server (mentioning a user from another server doesn't
 * make sense — they can't see this channel). Agents are resolved GLOBALLY against the marketplace,
 * so any agent registered in BonFire can be @-mentioned from any channel in any server. This
 * enables agent-to-agent intercommunication across server boundaries.
 */
export async function resolveMentions(db: Db, serverId: ObjectId, content: string): Promise<MessageMention[]> {
  const handles = extractHandles(content);
  if (handles.length === 0) return [];

  // Users: scope to server members (otherwise you'd be pinging someone who can't read the channel).
  const memberRows = await db.collection<ServerMemberDoc>(collections.serverMembers)
    .find({ serverId, principalType: 'user' }).toArray();
  const userIds = memberRows.map(m => m.principalId);

  const [users, agents] = await Promise.all([
    userIds.length
      ? db.collection<UserDoc>(collections.users).find(
          { _id: { $in: userIds }, username: { $in: handles } },
          { collation: ci }
        ).toArray()
      : Promise.resolve([] as UserDoc[]),
    // Agents: resolved globally — any marketplace agent is callable from anywhere.
    db.collection<AgentDoc>(collections.agents).find(
      { slug: { $in: handles } },
      { collation: ci }
    ).toArray(),
  ]);

  const out: MessageMention[] = [];
  const seen = new Set<string>();
  for (const u of users) {
    const k = `user:${u._id.toHexString()}`;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ type: 'user', id: u._id });
  }
  for (const a of agents) {
    const k = `agent:${a._id.toHexString()}`;
    if (seen.has(k)) continue; seen.add(k);
    out.push({ type: 'agent', id: a._id });
  }
  return out;
}
