/**
 * Auth helpers for integration tests.
 *
 * After the Privy auth refactor (Task E), email/password registration is gone.
 * registerAndLogin now provisions a user via the mock Privy token path so that
 * existing test suites continue to work without modification to their call sites.
 *
 * NOTE: tests that import this module must have '@privy-io/server-auth' mocked
 * (either at the test-file level or via a shared __mocks__ file). See
 * test/auth-privy.test.ts for the canonical mock setup.
 */

import type { Db } from 'mongodb';
import { buildApp } from '../../src/api/server.js';
import { jsonReq } from './app.js';
import { collections } from '../../src/db/types.js';

export interface RegisteredUser {
  token: string;
  user: { id: string; username: string; email: string | null; displayName: string };
}

/**
 * Provisions a test user by calling POST /v1/auth/privy/verify with a
 * deterministic mock token. Returns the user object and the token so callers
 * can attach `Authorization: Bearer <token>` to subsequent requests.
 *
 * The mock token format is `mock-token:<did>` — this matches what the
 * MockPrivyClient set up in auth-privy.test.ts expects.
 *
 * @param app      - Hono app returned by makeApp()
 * @param override - Optional overrides for username / displayName (these are
 *                   applied via a seed, not the Privy flow, so display-name
 *                   overrides are cosmetic here)
 */
export async function registerAndLogin(
  app: ReturnType<typeof buildApp>,
  override: Partial<{ email: string; username: string; password: string; displayName: string }> = {},
  db?: Db,
): Promise<RegisteredUser> {
  const seed = Math.random().toString(36).slice(2, 8);
  // When a username override is provided, use it directly as the privyDid so
  // that the auth route's auto-derived username ("did.replace(/[^a-z0-9_-]/gi,'')")
  // equals the requested value exactly (e.g. DID "alice" → username "alice").
  // When no override is given, fall back to a random unique DID.
  const privyDid = override.username ?? `did:privy:test-${seed}`;
  const token = `mock-token:${privyDid}`;

  const res = await jsonReq(app, 'POST', '/v1/auth/privy/verify', { token });
  if (res.status !== 200) {
    throw new Error(`registerAndLogin: /v1/auth/privy/verify failed (${res.status}): ${JSON.stringify(res.body)}`);
  }

  // If db is provided and a displayName override was given, apply it directly
  // (the Privy flow derives displayName from the DID/email, not the override).
  if (db && override.displayName) {
    await db.collection(collections.users).updateOne(
      { privyDid },
      { $set: { displayName: override.displayName } },
    );
    res.body.user.displayName = override.displayName;
  }

  return { token, user: res.body.user };
}
