/**
 * Global test setup — mocks @privy-io/server-auth for all test files.
 *
 * Loaded via vitest setupFiles. Every test suite automatically gets
 * a MockPrivyClient that resolves "mock-token:<did>" tokens without
 * making any real network calls to Privy.
 *
 * Token format: "mock-token:<privyDid>"
 *   - verifyAuthToken resolves for this pattern; rejects for all others.
 *   - getUser returns a deterministic wallet (0xDEAD...0001) and email derived
 *     from the DID so tests can assert on stable values.
 */

import { vi } from 'vitest';

// PrivyClient constructor (even when mocked) is called via process.env reads.
// Provide stable fake values so getPrivyClient() never throws in tests.
process.env.PRIVY_APP_ID = process.env.PRIVY_APP_ID ?? 'test-privy-app-id';
process.env.PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET ?? 'test-privy-app-secret';

vi.mock('@privy-io/server-auth', () => {
  class MockPrivyClient {
    async verifyAuthToken(token: string) {
      if (!token.startsWith('mock-token:')) {
        throw new Error('mock: invalid token');
      }
      const userId = token.slice('mock-token:'.length);
      if (!userId) throw new Error('mock: empty userId');
      return { userId, appId: 'mock-app', issuer: 'privy.io', issuedAt: new Date() };
    }

    async getUser(userId: string) {
      // Derive a deterministic-but-unique wallet address from the userId so
      // tests provisioning multiple users don't collide on the unique index.
      const hex = userId.replace(/[^a-f0-9]/gi, '').padEnd(40, '0').slice(0, 40);
      const walletAddress = `0x${hex}`;
      return {
        id: userId,
        linkedAccounts: [
          { type: 'wallet', walletClientType: 'privy', address: walletAddress },
          { type: 'email', address: `${userId.replace(/[^a-z0-9]/gi, '-')}@mock.privy.test` },
        ],
      };
    }
  }

  return { PrivyClient: MockPrivyClient };
});
