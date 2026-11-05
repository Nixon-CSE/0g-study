import { randomBytes, createHash } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import type { AgentDoc } from '../db/types.js';
import { collections } from '../db/types.js';

export class AgentSlugTakenError extends Error { code = 'agent_slug_taken' as const; }

function newAgentKey(): { key: string; hash: string } {
  const raw = randomBytes(16).toString('hex');
  const key = `bka_${raw}`;
  const hash = createHash('sha256').update(key).digest('hex');
  return { key, hash };
}

export function hashAgentKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export interface CreateAgentInput {
  name: string;
  slug: string;
  baseUrl: string;
  description: string;
  bio?: string | null;
  avatarUrl?: string | null;
  tags?: string[];
  createdBy: ObjectId;
  /** NOT persisted — proxied to the agent server's /tenants before MongoDB insert. */
  soul?: string;
  /** NOT persisted — proxied to the agent server's /tenants before MongoDB insert. */
  agents?: string;
  /** NOT persisted — proxied to the agent server's /tenants before MongoDB insert. */
  env?: Record<string, string>;
  /** NOT persisted — proxied to the agent server's /tenants before MongoDB insert. */
  llm?: Record<string, unknown>;
}

export async function createAgent(db: Db, input: CreateAgentInput): Promise<{ agent: AgentDoc; agentKey: string }> {
  const now = new Date();
  const { key, hash } = newAgentKey();
  const doc: AgentDoc = {
    _id: new OID(),
    name: input.name,
    slug: input.slug.toLowerCase(),
    avatarUrl: input.avatarUrl ?? null,
    description: input.description,
    bio: input.bio ?? null,
    tags: input.tags ?? [],
    baseUrl: input.baseUrl,
    visibility: 'public',
    agentKeyHash: hash,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  try { await db.collection<AgentDoc>(collections.agents).insertOne(doc); }
  catch (e: any) { if (e?.code === 11000) throw new AgentSlugTakenError(); throw e; }
  return { agent: doc, agentKey: key };
}

export async function findAgentByIdOrSlug(db: Db, idOrSlug: string): Promise<AgentDoc | null> {
  if (OID.isValid(idOrSlug) && idOrSlug.length === 24) {
    const byId = await db.collection<AgentDoc>(collections.agents).findOne({ _id: new OID(idOrSlug) });
    if (byId) return byId;
  }
  return await db.collection<AgentDoc>(collections.agents).findOne(
    { slug: idOrSlug.toLowerCase() },
    { collation: { locale: 'en', strength: 2 } }
  );
}

export async function listPublicAgents(db: Db, opts: { q?: string; tag?: string; limit?: number; cursor?: string }): Promise<AgentDoc[]> {
  const filter: Record<string, unknown> = {};
  if (opts.tag) filter.tags = opts.tag;
  if (opts.q) filter.name = { $regex: opts.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const cursor = db.collection<AgentDoc>(collections.agents).find(filter);
  if (opts.cursor && OID.isValid(opts.cursor)) cursor.filter({ _id: { $lt: new OID(opts.cursor) } });
  return await cursor.sort({ _id: -1 }).limit(Math.min(opts.limit ?? 50, 100)).toArray();
}

export async function deleteAgent(db: Db, agentId: ObjectId): Promise<boolean> {
  const res = await db.collection(collections.agents).deleteOne({ _id: agentId });
  return res.deletedCount === 1;
}

export async function rotateAgentKey(db: Db, agentId: ObjectId): Promise<string | null> {
  const { key, hash } = newAgentKey();
  const res = await db.collection<AgentDoc>(collections.agents).findOneAndUpdate(
    { _id: agentId },
    { $set: { agentKeyHash: hash, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return res ? key : null;
}

export async function findAgentByKeyHash(db: Db, hash: string): Promise<AgentDoc | null> {
  return await db.collection<AgentDoc>(collections.agents).findOne({ agentKeyHash: hash });
}

export function publicAgent(a: AgentDoc) {
  return {
    id: a._id.toHexString(),
    name: a.name,
    slug: a.slug,
    avatarUrl: a.avatarUrl,
    description: a.description,
    bio: a.bio,
    tags: a.tags,
    baseUrl: a.baseUrl,
    createdBy: a.createdBy ? a.createdBy.toHexString() : null,
    createdAt: a.createdAt.toISOString(),
    priceOg: a.priceOg ?? '0',
    ownerWallet: a.ownerWallet ?? null,
    tokenId: a.tokenId ?? null,
    contractAddress: a.contractAddress ?? null,
    manifestUri: a.manifestUri ?? null,
    bundleUri: a.bundleUri ?? null,
    sealedDEKBaseUri: a.sealedDEKBaseUri ?? null,
    bundleHash: a.bundleHash ?? null,
  };
}
