import type { Db, ObjectId } from 'mongodb';
import { ObjectId as OID } from 'mongodb';
import type { UserDoc } from '../db/types.js';
import { collections } from '../db/types.js';

const ci = { locale: 'en', strength: 2 } as const;

export interface CreateUserInput {
  privyDid?: string;
  walletAddress?: string | null;
  email?: string | null;
  username: string;
  passwordHash?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isService?: boolean;
}

export async function createUser(db: Db, input: CreateUserInput): Promise<UserDoc> {
  const now = new Date();
  const doc: UserDoc = {
    _id: new OID(),
    privyDid: input.privyDid ?? '',
    walletAddress: input.walletAddress ?? null,
    email: input.email ? input.email.toLowerCase() : null,
    username: input.username.toLowerCase(),
    passwordHash: input.passwordHash ?? null,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl ?? null,
    bio: input.bio ?? null,
    isService: input.isService ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<UserDoc>(collections.users).insertOne(doc);
  return doc;
}

export async function findUserByEmailOrUsername(db: Db, identifier: string): Promise<UserDoc | null> {
  const lc = identifier.toLowerCase();
  return await db.collection<UserDoc>(collections.users).findOne(
    { $or: [{ email: lc }, { username: lc }] },
    { collation: ci }
  );
}

export async function findUserById(db: Db, id: ObjectId): Promise<UserDoc | null> {
  return await db.collection<UserDoc>(collections.users).findOne({ _id: id });
}

export async function findUserByUsername(db: Db, username: string): Promise<UserDoc | null> {
  return await db.collection<UserDoc>(collections.users).findOne(
    { username: username.toLowerCase() },
    { collation: ci }
  );
}

export function publicUser(u: UserDoc) {
  return {
    id: u._id.toHexString(),
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    createdAt: u.createdAt.toISOString(),
  };
}

export function privateUser(u: UserDoc) {
  return { ...publicUser(u), email: u.email, isService: u.isService };
}

export interface ProfileUpdate {
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
}

export async function updateUserProfile(db: Db, userId: ObjectId, patch: ProfileUpdate): Promise<UserDoc | null> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.displayName !== undefined) $set.displayName = patch.displayName;
  if (patch.avatarUrl !== undefined) $set.avatarUrl = patch.avatarUrl;
  if (patch.bio !== undefined) $set.bio = patch.bio;
  const res = await db.collection<UserDoc>(collections.users).findOneAndUpdate(
    { _id: userId }, { $set }, { returnDocument: 'after' }
  );
  return res ?? null;
}

export async function updateUserPasswordHash(db: Db, userId: ObjectId, passwordHash: string): Promise<void> {
  await db.collection<UserDoc>(collections.users).updateOne(
    { _id: userId }, { $set: { passwordHash, updatedAt: new Date() } }
  );
}
