/**
 * Privy backend auth — token verification and claim extraction.
 *
 * Required environment variables:
 *   PRIVY_APP_ID     — your Privy application ID (required)
 *   PRIVY_APP_SECRET — your Privy application secret (required)
 */

import { PrivyClient } from '@privy-io/server-auth';
import { log } from '../util/logger.js';

/** Thrown before token verification when server env lacks Privy credentials. */
export class PrivyEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyEnvError';
  }
}

export interface PrivyClaims {
  /** Privy DID, e.g. "did:privy:abc123..." */
  privyDid: string;
  /** Embedded wallet address (0x...) provisioned by Privy; null if not yet created */
  walletAddress: string | null;
  /** Email linked to this Privy account; null for social/wallet-only logins */
  email: string | null;
}

// Lazily initialised singleton — avoids env reads at module load time (helps test isolation).
let _privyClient: PrivyClient | null = null;

/**
 * Returns the shared PrivyClient instance, instantiating it on first call.
 * Reads PRIVY_APP_ID and PRIVY_APP_SECRET from process.env.
 *
 * @throws Error if PRIVY_APP_ID or PRIVY_APP_SECRET are not set
 */
export function getPrivyClient(): PrivyClient {
  if (_privyClient) return _privyClient;

  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;

  if (!appId || !appSecret) {
    throw new PrivyEnvError(
      'Set PRIVY_APP_ID and PRIVY_APP_SECRET in backend/.env (Privy Dashboard → Apps → Your app → Basics & API Keys). Values must match the same app as NEXT_PUBLIC_PRIVY_APP_ID on the frontend.',
    );
  }

  _privyClient = new PrivyClient(appId, appSecret);
  return _privyClient;
}

/** Replace the singleton — used in tests to inject a mock client. */
export function _setPrivyClient(client: PrivyClient | null): void {
  _privyClient = client;
}

/**
 * Verifies a Privy access token and returns normalised claims.
 *
 * Flow:
 *   1. verifyAuthToken(token) — validates signature, expiry, and iss
 *   2. getUser(userId) — fetches the full user object for wallet/email
 *
 * @param token - Raw Bearer token from the Authorization header
 * @returns PrivyClaims
 * @throws Error('invalid privy token') on any verification failure (message
 *   is safe to return to the client — the real error is only logged server-side)
 */
export async function verifyPrivyToken(token: string): Promise<PrivyClaims> {
  const privy = getPrivyClient();

  let verifiedClaims: Awaited<ReturnType<PrivyClient['verifyAuthToken']>>;
  try {
    verifiedClaims = await privy.verifyAuthToken(token);
  } catch (err) {
    log.warn({ err: { message: (err as Error)?.message } }, 'privy token verification failed');
    throw new Error('invalid privy token');
  }

  const userId = verifiedClaims.userId;
  let walletAddress: string | null = null;
  let email: string | null = null;

  try {
    const privyUser = await privy.getUser(userId);

    const embeddedWallet = privyUser.linkedAccounts?.find(
      (a: { type: string; walletClientType?: string }) => a.type === 'wallet' && a.walletClientType === 'privy'
    );
    walletAddress = (embeddedWallet && 'address' in embeddedWallet)
      ? (embeddedWallet as { address: string }).address
      : null;

    const emailAccount = privyUser.linkedAccounts?.find(
      (a: { type: string }) => a.type === 'email'
    );
    email = (emailAccount && 'address' in emailAccount)
      ? (emailAccount as { address: string }).address
      : null;
  } catch (err) {
    // Non-fatal — claims are still valid; enrichment just unavailable.
    log.warn({ userId, err }, 'privy getUser failed after successful token verification');
  }

  return {
    privyDid: userId,
    walletAddress,
    email,
  };
}
