import type { Db, ObjectId } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import type { MessageDoc, MessageMention, PrincipalType } from '../db/types.js';
import { collections } from '../db/types.js';

export interface InsertMessageInput {
  channelId: ObjectId;
  serverId: ObjectId;
  authorType: PrincipalType;
  authorId: ObjectId;
  content: string;
  mentions: MessageMention[];
  replyToId?: ObjectId | null;
  /** TEE attestation hash — stamped on agent replies in private channels. */
  teeHash?: string;
}

export async function insertMessage(db: Db, input: InsertMessageInput): Promise<MessageDoc> {
  const doc: MessageDoc = {
    _id: new OID(),
    channelId: input.channelId,
    serverId: input.serverId,
    authorType: input.authorType,
    authorId: input.authorId,
    content: input.content,
    mentions: input.mentions,
    replyToId: input.replyToId ?? null,
    createdAt: new Date(),
    editedAt: null,
  };
  if (input.teeHash) doc.teeHash = input.teeHash;
  await db.collection<MessageDoc>(collections.messages).insertOne(doc);
  return doc;
}

export async function listChannelMessages(db: Db, channelId: ObjectId, opts: { limit?: number; before?: ObjectId | null }): Promise<{ messages: MessageDoc[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const filter: Record<string, unknown> = { channelId };
  if (opts.before) filter._id = { $lt: opts.before };
  const docs = await db.collection<MessageDoc>(collections.messages)
    .find(filter).sort({ _id: -1 }).limit(limit).toArray();
  const nextCursor = docs.length === limit ? docs[docs.length - 1]._id.toHexString() : null;
  return { messages: docs, nextCursor };
}

export async function findMessageById(db: Db, id: ObjectId): Promise<MessageDoc | null> {
  return await db.collection<MessageDoc>(collections.messages).findOne({ _id: id });
}

export async function deleteMessage(db: Db, id: ObjectId): Promise<boolean> {
  const res = await db.collection(collections.messages).deleteOne({ _id: id });
  return res.deletedCount === 1;
}

export function publicMessage(m: MessageDoc) {
  return {
    id: m._id.toHexString(),
    channelId: m.channelId.toHexString(),
    serverId: m.serverId.toHexString(),
    authorType: m.authorType,
    authorId: m.authorId.toHexString(),
    content: m.content,
    mentions: m.mentions.map(x => ({ type: x.type, id: x.id.toHexString() })),
    replyToId: m.replyToId?.toHexString() ?? null,
    parentMessageId: m.parentMessageId?.toHexString() ?? null,
    cascadeRootId: m.cascadeRootId?.toHexString() ?? null,
    cascadeHop: m.cascadeHop ?? null,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    teeHash: m.teeHash ?? null,
  };
}
