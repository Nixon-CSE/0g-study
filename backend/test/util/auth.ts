/**
 * Test utilities for Privy auth.
 *
 * Provides:
 *   - provisionTestUser — inserts a UserDoc directly into Mongo (bypasses the real Privy flow)
 *   - mockPrivyAuthFor  — returns a mock token string that the mock PrivyClient resolves to a given DID
 *
 * Usage pattern:
 *   vi.mock('../../src/auth/privy.js', ...) sets up the mock client; these helpers then
 *   vend tokens + users that match what the mock returns.
 */

import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import type { UserDoc } from '../../src/db/types.js';
import { collections } from '../../src/db/types.js';

export interface TestUser extends UserDoc {}

/**
 * Inserts a UserDoc directly into the test database.
 * Use this when you need a pre-existing user for a test scenario.
 *
 * @param db      - Mongo Db instance from the test harness
 * @param overrides - Optional field overrides (e.g. username, walletAddress)
 * @returns The inserted UserDoc (with _id populated)
 */
export async function provisionTestUser(
  db: Db,
  overrides: Partial<UserDoc> = {}
): Promise<TestUser> {
  const seed = Math.random().toString(36).slice(2, 8);
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    privyDid: `did:privy:test-${seed}`,
    walletAddress: null,
    email: null,
    passwordHash: null,
    username: `tester-${seed}`,
    displayName: `Tester ${seed}`,
    avatarUrl: null,
    bio: null,
    isService: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await db.collection<UserDoc>(collections.users).insertOne(doc);
  return doc;
}

/**
 * Returns a deterministic mock token string for the given Privy DID.
 *
 * The token format is:  `mock-token:<privyDid>`
 * The mock PrivyClient (set up via vi.mock) must decode this format and return
 * matching claims. See auth-privy.test.ts for how to wire the mock.
 *
 * @param privyDid - The DID this token should resolve to
 */
export function mockPrivyAuthFor(privyDid: string): string {
  return `mock-token:${privyDid}`;
}
