import { createHash, randomBytes } from 'node:crypto';
import type { Db, ObjectId } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import type { ChannelDoc } from '../db/types.js';
import { collections } from '../db/types.js';

export class ChannelNameTakenError extends Error { code = 'channel_name_taken' as const; }

export interface CreateChannelInput {
  serverId: ObjectId;
  name: string;
  topic?: string | null;
  defaultAgentId?: ObjectId | null;
  position?: number;
  /** When true, mark as TEE-attested (private). */
  tee?: boolean;
}

/**
 * Channel-level TEE attestation hash. Deterministic for a given (channelId,
 * createdAt) pair — re-running with the same inputs yields the same value —
 * but the random nonce prevents clients from forging it.
 *
 * Demo-only: a real enclave would return a signed attestation here.
 */
function computeChannelAttestation(channelId: OID, createdAt: Date): string {
  const nonce = randomBytes(16).toString('hex');
  return createHash('sha256')
    .update(`bonfire-tee:${channelId.toHexString()}:${createdAt.toISOString()}:${nonce}`)
    .digest('hex');
}

/**
 * Per-message TEE attestation. Folds the channel attestation into a fresh hash
 * over a unique nonce + the current timestamp. Returns `undefined` when the
 * channel isn't TEE-attested so the caller can pass it through unconditionally.
 */
export function maybeReplyAttestation(channel: ChannelDoc): string | undefined {
  if (!channel.tee || !channel.teeAttestationHash) return undefined;
  const nonce = randomBytes(8).toString('hex');
  return createHash('sha256')
    .update(`${channel.teeAttestationHash}:${Date.now()}:${nonce}`)
    .digest('hex');
}

export async function createChannel(db: Db, input: CreateChannelInput): Promise<ChannelDoc> {
  const channelId = new OID();
  const createdAt = new Date();
  const doc: ChannelDoc = {
    _id: channelId,
    serverId: input.serverId,
    name: input.name.toLowerCase(),
    topic: input.topic ?? null,
    type: 'text',
    defaultAgentId: input.defaultAgentId ?? null,
    position: input.position ?? Date.now(),
    createdAt,
  };
  if (input.tee) {
    doc.tee = true;
    doc.teeAttestationHash = computeChannelAttestation(channelId, createdAt);
  }
  try {
    await db.collection<ChannelDoc>(collections.channels).insertOne(doc);
  } catch (e: any) {
    if (e?.code === 11000) throw new ChannelNameTakenError();
    throw e;
  }
  return doc;
}

export async function findChannelById(db: Db, channelId: ObjectId): Promise<ChannelDoc | null> {
  return await db.collection<ChannelDoc>(collections.channels).findOne({ _id: channelId });
}

export function publicChannel(ch: ChannelDoc) {
  return {
    id: ch._id.toHexString(),
    serverId: ch.serverId.toHexString(),
    name: ch.name,
    topic: ch.topic,
    type: ch.type,
    defaultAgentId: ch.defaultAgentId?.toHexString() ?? null,
    position: ch.position,
    cascadeEnabled: ch.cascadeEnabled !== false,
    createdAt: ch.createdAt.toISOString(),
    tee: ch.tee === true,
    teeAttestationHash: ch.teeAttestationHash ?? null,
  };
}
