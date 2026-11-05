import type { Db, ObjectId } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import type { ServerDoc, ServerMemberDoc, ChannelDoc, ServerWalletDoc, PrincipalType, MemberRole } from '../db/types.js';
import { collections } from '../db/types.js';
import { createServerWallet } from './wallet.js';

export class SlugTakenError extends Error { code = 'slug_taken' as const; }

export interface CreateServerInput {
  name: string;
  slug: string;
  iconUrl?: string | null;
  ownerId: ObjectId;
}

export async function createServer(db: Db, input: CreateServerInput): Promise<{ server: ServerDoc; defaultChannel: ChannelDoc; ownerMember: ServerMemberDoc }> {
  const now = new Date();
  const slug = input.slug.toLowerCase();

  const existing = await db.collection<ServerDoc>(collections.servers).findOne({ slug }, { collation: { locale: 'en', strength: 2 } });
  if (existing) throw new SlugTakenError();

  const wallet = createServerWallet();

  const server: ServerDoc = {
    _id: new OID(),
    name: input.name,
    slug,
    iconUrl: input.iconUrl ?? null,
    ownerId: input.ownerId,
    wallet,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.collection<ServerDoc>(collections.servers).insertOne(server);
  } catch (e: any) {
    if (e?.code === 11000) throw new SlugTakenError();
    throw e;
  }

  const ownerMember: ServerMemberDoc = {
    _id: new OID(),
    serverId: server._id,
    principalType: 'user',
    principalId: input.ownerId,
    role: 'owner',
    alias: null,
    joinedAt: now,
  };
  await db.collection<ServerMemberDoc>(collections.serverMembers).insertOne(ownerMember);

  const defaultChannel: ChannelDoc = {
    _id: new OID(),
    serverId: server._id,
    name: 'general',
    topic: null,
    type: 'text',
    defaultAgentId: null,
    position: 0,
    createdAt: now,
  };
  await db.collection<ChannelDoc>(collections.channels).insertOne(defaultChannel);

  const voiceChannel: ChannelDoc = {
    _id: new OID(),
    serverId: server._id,
    name: 'general-voice',
    topic: null,
    type: 'voice',
    defaultAgentId: null,
    position: 1,
    createdAt: now,
  };
  await db.collection<ChannelDoc>(collections.channels).insertOne(voiceChannel);

  const auditChannel: ChannelDoc = {
    _id: new OID(),
    serverId: server._id,
    name: 'audit-log',
    topic: null,
    type: 'audit',
    defaultAgentId: null,
    position: 2,
    createdAt: now,
  };
  await db.collection<ChannelDoc>(collections.channels).insertOne(auditChannel);

  const knowledgeChannel: ChannelDoc = {
    _id: new OID(),
    serverId: server._id,
    name: 'knowledge-base',
    topic: 'Shared notes & docs — auto-fed into every agent on this server.',
    type: 'knowledge',
    defaultAgentId: null,
    position: 3,
    createdAt: now,
  };
  await db.collection<ChannelDoc>(collections.channels).insertOne(knowledgeChannel);

  return { server, defaultChannel, ownerMember };
}

export async function findServerByIdOrSlug(db: Db, idOrSlug: string): Promise<ServerDoc | null> {
  if (OID.isValid(idOrSlug) && idOrSlug.length === 24) {
    const byId = await db.collection<ServerDoc>(collections.servers).findOne({ _id: new OID(idOrSlug) });
    if (byId) return byId;
  }
  return await db.collection<ServerDoc>(collections.servers).findOne(
    { slug: idOrSlug.toLowerCase() },
    { collation: { locale: 'en', strength: 2 } }
  );
}

export async function listServersForUser(db: Db, userId: ObjectId): Promise<ServerDoc[]> {
  const memberships = await db.collection<ServerMemberDoc>(collections.serverMembers)
    .find({ principalId: userId, principalType: 'user' }).toArray();
  const ids = memberships.map(m => m.serverId);
  if (ids.length === 0) return [];
  return await db.collection<ServerDoc>(collections.servers).find({ _id: { $in: ids } }).toArray();
}

export async function findMembership(db: Db, serverId: ObjectId, principalType: PrincipalType, principalId: ObjectId): Promise<ServerMemberDoc | null> {
  return await db.collection<ServerMemberDoc>(collections.serverMembers).findOne({ serverId, principalType, principalId });
}

export async function listServerMembers(db: Db, serverId: ObjectId, type?: PrincipalType): Promise<ServerMemberDoc[]> {
  const filter: Record<string, unknown> = { serverId };
  if (type) filter.principalType = type;
  return await db.collection<ServerMemberDoc>(collections.serverMembers).find(filter).toArray();
}

export async function addMember(db: Db, input: {
  serverId: ObjectId; principalType: PrincipalType; principalId: ObjectId; role?: MemberRole; alias?: string | null;
  paidTxHash?: string; paidAmount?: string; paidByUserId?: ObjectId;
}): Promise<ServerMemberDoc> {
  const doc: ServerMemberDoc = {
    _id: new OID(),
    serverId: input.serverId,
    principalType: input.principalType,
    principalId: input.principalId,
    role: input.role ?? 'member',
    alias: input.alias ?? null,
    joinedAt: new Date(),
  };
  if (input.paidTxHash !== undefined) doc.paidTxHash = input.paidTxHash;
  if (input.paidAmount !== undefined) doc.paidAmount = input.paidAmount;
  if (input.paidByUserId !== undefined) doc.paidByUserId = input.paidByUserId;
  await db.collection<ServerMemberDoc>(collections.serverMembers).insertOne(doc);
  return doc;
}

export async function removeMember(db: Db, memberId: ObjectId): Promise<boolean> {
  const res = await db.collection<ServerMemberDoc>(collections.serverMembers).deleteOne({ _id: memberId });
  return res.deletedCount === 1;
}

export async function getServerWallet(db: Db, serverId: ObjectId): Promise<ServerWalletDoc | null> {
  const server = await db.collection<ServerDoc>(collections.servers).findOne({ _id: serverId });
  return server?.wallet ?? null;
}

export function publicServer(s: ServerDoc) {
  return {
    id: s._id.toHexString(),
    name: s.name,
    slug: s.slug,
    iconUrl: s.iconUrl,
    ownerId: s.ownerId.toHexString(),
    createdAt: s.createdAt.toISOString(),
  };
}

export function publicWallet(w: ServerWalletDoc) {
  return {
    address: w.address,
    network: w.network,
    createdAt: w.createdAt.toISOString(),
  };
}

export function ownerWallet(w: ServerWalletDoc) {
  return {
    address: w.address,
    privateKey: w.privateKey,
    network: w.network,
    createdAt: w.createdAt.toISOString(),
  };
}

export function publicMember(m: ServerMemberDoc) {
  return {
    id: m._id.toHexString(),
    serverId: m.serverId.toHexString(),
    principalType: m.principalType,
    principalId: m.principalId.toHexString(),
    role: m.role,
    alias: m.alias,
    joinedAt: m.joinedAt.toISOString(),
  };
}
