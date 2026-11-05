/**
 * Tests for INFT mint endpoints:
 *   POST /v1/agents/mint          — prepares on-chain payload + uploads blobs
 *   POST /v1/agents/mint/confirm  — links tokenId → AgentDoc after on-chain confirmation
 *
 * Mock strategy:
 *   - @privy-io/server-auth   → vi.mock decodes "mock-token:<did>" tokens (same pattern
 *                               as auth-privy.test.ts)
 *   - OG_STORAGE_MOCK=1       → filesystem-backed mock storage (no real 0G network)
 *   - InftChain               → vi.mock for the chain client (no real RPC needed)
 *   - PLATFORM_EXECUTOR_PRIVATE_KEY → seeded to a deterministic test key
 *   - INFT_CONTRACT_ADDRESS   → set to a dummy address
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { provisionTestUser, mockPrivyAuthFor } from './util/auth.js';
import { keccak256 } from 'ethers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Deterministic 32-byte private key used as PLATFORM_EXECUTOR_PRIVATE_KEY */
const TEST_PLATFORM_PRIVKEY = '0x' + '11'.repeat(32);

/** Wallet address used as the test minter */
const MINTER_WALLET = '0x' + 'aa'.repeat(20);

/** Dummy contract address */
const CONTRACT_ADDRESS = '0x' + 'bb'.repeat(20);

// ---------------------------------------------------------------------------
// Mock @privy-io/server-auth
// Identical pattern to auth-privy.test.ts — mock-token:<did> encoding.
// ---------------------------------------------------------------------------

vi.mock('@privy-io/server-auth', () => {
  class MockPrivyClient {
    async verifyAuthToken(token: string) {
      if (!token.startsWith('mock-token:')) {
        throw new Error('mock: invalid token');
      }
      const userId = token.slice('mock-token:'.length);
      return { userId, appId: 'mock-app', issuer: 'privy.io', issuedAt: new Date() };
    }

    async getUser(userId: string) {
      return {
        id: userId,
        linkedAccounts: [
          { type: 'wallet', walletClientType: 'privy', address: MINTER_WALLET },
          { type: 'email', address: 'minter@test.local' },
        ],
      };
    }
  }
  return { PrivyClient: MockPrivyClient };
});

// ---------------------------------------------------------------------------
// Mock the chain client
// Keeps tests isolated from real RPC calls (and from the ABI file that
// Task A hasn't delivered yet). We intercept createInftChain so callers
// receive a controllable mock InftChain.
// ---------------------------------------------------------------------------

/** Result returned by the mock verifyMintTx — tests can override this per-test. */
let mockMintTxResult: { tokenId: bigint; owner: string; mode: number; bundleHash: string } | null = null;
let mockMintTxError: Error | null = null;

vi.mock('../src/chain/index.js', () => {
  class MockInftChain {
    async agentOf() { throw new Error('not implemented in test mock'); }
    async isAuthorized() { return false; }
    async ownerOf() { return MINTER_WALLET; }
    async verifyMintTx(_txHash: string) {
      if (mockMintTxError) throw mockMintTxError;
      if (!mockMintTxResult) throw new Error('mockMintTxResult not set');
      return mockMintTxResult;
    }
  }

  return {
    createInftChain: () => new MockInftChain(),
    InftChain: MockInftChain,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Valid mint request body used as a baseline across test cases.
 */
function validMintBody(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent for the mint flow',
    avatarUrl: null,
    tags: ['test'],
    soul: 'You are a helpful test assistant.',
    agents: '# AGENTS\nBe concise.',
    llm: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('mint endpoints', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;

  /**
   * DID / token for the minting user. Shared across most tests.
   * Each test that needs a different identity should provision its own.
   */
  const MINTER_DID = 'did:privy:mint-test-user';
  const MINTER_TOKEN = mockPrivyAuthFor(MINTER_DID);

  beforeAll(async () => {
    tdb = await startTestDb();
  });

  afterAll(async () => {
    await stopTestDb();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    // Clean DB state
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);

    // Reset chain mock state
    mockMintTxResult = null;
    mockMintTxError = null;

    // Env stubs for this test — safe to call multiple times
    vi.stubEnv('OG_STORAGE_MOCK', '1');
    vi.stubEnv('PLATFORM_EXECUTOR_PRIVATE_KEY', TEST_PLATFORM_PRIVKEY);
    vi.stubEnv('INFT_CONTRACT_ADDRESS', CONTRACT_ADDRESS);
    vi.stubEnv('OG_RPC_URL', 'http://fake-rpc.test');

    // Pre-provision the minter user with the expected wallet address so
    // requireUser middleware upserts against an existing doc.
    await provisionTestUser(tdb.db, {
      privyDid: MINTER_DID,
      walletAddress: MINTER_WALLET,
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint — happy path
  // -------------------------------------------------------------------------

  it('happy path: returns mintPayload + reservationId and uploads three blobs', async () => {
    const r = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('mintPayload');
    expect(r.body).toHaveProperty('reservationId');
    expect(r.body).toHaveProperty('contractAddress');

    const { mintPayload, reservationId } = r.body;

    // mintPayload must carry all fields the contract call needs
    expect(mintPayload).toHaveProperty('manifestUri');
    expect(mintPayload).toHaveProperty('bundleUri');
    expect(mintPayload).toHaveProperty('sealedDEKBaseUri');
    expect(mintPayload).toHaveProperty('bundleHash');
    expect(mintPayload.mode).toBe(0); // mint API always requests public-only on-chain mode

    // reservationId must be a UUID
    expect(reservationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    // bundleHash must be a 0x-prefixed keccak256 hex string
    expect(mintPayload.bundleHash).toMatch(/^0x[0-9a-f]{64}$/i);

    // URIs must be non-empty strings
    expect(typeof mintPayload.manifestUri).toBe('string');
    expect(mintPayload.manifestUri.length).toBeGreaterThan(0);
    expect(typeof mintPayload.bundleUri).toBe('string');
    expect(mintPayload.bundleUri.length).toBeGreaterThan(0);
    expect(typeof mintPayload.sealedDEKBaseUri).toBe('string');
    expect(mintPayload.sealedDEKBaseUri.length).toBeGreaterThan(0);

    // A MintReservationDoc must have been written to Mongo
    const { collections } = await import('../src/db/types.js');
    const doc = await tdb.db.collection(collections.mintReservations).findOne({ reservedId: reservationId });
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe('uploaded');
    expect(doc!.slug).toBe('test-agent');
    expect(doc!.bundleHash).toBe(mintPayload.bundleHash);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint — duplicate slug
  // -------------------------------------------------------------------------

  it('duplicate slug in agents collection → 409', async () => {
    // Insert an existing agent with the same slug
    const { collections } = await import('../src/db/types.js');
    await tdb.db.collection(collections.agents).insertOne({
      slug: 'test-agent',
      name: 'Existing', description: 'x', tags: [], visibility: 'public',
      baseUrl: 'http://x:7777', createdAt: new Date(), updatedAt: new Date(),
    } as unknown as import('../src/db/types.js').AgentDoc);

    const r = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('agent_slug_taken');
  });

  it('duplicate slug via active reservation → 409', async () => {
    const { collections } = await import('../src/db/types.js');
    const now = new Date();
    await tdb.db.collection(collections.mintReservations).insertOne({
      reservedId: 'some-existing-uuid',
      userId: new (await import('mongodb')).ObjectId(),
      slug: 'test-agent',
      manifestUri: 'mock://x',
      bundleUri: 'mock://y',
      sealedDEKBaseUri: 'mock://z',
      bundleHash: '0x' + '00'.repeat(32),
      status: 'uploaded',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000), // still valid
    });

    const r = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(r.status).toBe(409);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint — Zod validation failures
  // -------------------------------------------------------------------------

  it('invalid llm config (bad temperature) → 400', async () => {
    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint',
      validMintBody({ llm: { temperature: 999 } }),
      MINTER_TOKEN,
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });

  it('missing soul → 400', async () => {
    const body = validMintBody();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (body as any).soul;
    const r = await jsonReq(app, 'POST', '/v1/agents/mint', body, MINTER_TOKEN);
    expect(r.status).toBe(400);
  });

  it('slug too short → 400', async () => {
    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint',
      validMintBody({ slug: 'ab' }), // minimum is 3 chars
      MINTER_TOKEN,
    );
    expect(r.status).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    const r = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody());
    expect(r.status).toBe(401);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — happy path
  // -------------------------------------------------------------------------

  it('/confirm happy path: inserts AgentDoc and marks reservation minted', async () => {
    // Step 1: run /mint to create a reservation
    const mintRes = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(mintRes.status).toBe(200);

    const { reservationId, mintPayload } = mintRes.body;

    // Step 2: configure mock chain to return matching fields
    mockMintTxResult = {
      tokenId: BigInt(42),
      owner: MINTER_WALLET,
      mode: 0,
      bundleHash: mintPayload.bundleHash,
    };

    // Step 3: call /confirm
    const confirmRes = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      {
        txHash: '0x' + 'cc'.repeat(32),
        reservationId,
      },
      MINTER_TOKEN,
    );

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body).toHaveProperty('agent');
    expect(confirmRes.body.agent.slug).toBe('test-agent');
    expect(confirmRes.body.agent.tokenId ?? confirmRes.body.agent.id).toBeTruthy();

    // Verify AgentDoc was actually inserted in Mongo
    const { collections } = await import('../src/db/types.js');
    const agentDoc = await tdb.db.collection(collections.agents).findOne({ slug: 'test-agent' });
    expect(agentDoc).not.toBeNull();
    expect(agentDoc!.tokenId).toBe('42');
    expect(agentDoc!.ownerWallet?.toLowerCase()).toBe(MINTER_WALLET.toLowerCase());
    expect(agentDoc!.visibility).toBe('public');

    // Verify reservation is marked minted
    const reservation = await tdb.db
      .collection(collections.mintReservations)
      .findOne({ reservedId: reservationId });
    expect(reservation!.status).toBe('minted');
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — mismatched bundleHash
  // -------------------------------------------------------------------------

  it('/confirm: mismatched bundleHash → 400', async () => {
    const mintRes = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(mintRes.status).toBe(200);

    const { reservationId } = mintRes.body;

    // Return a different bundleHash from the chain
    mockMintTxResult = {
      tokenId: BigInt(1),
      owner: MINTER_WALLET,
      mode: 0,
      bundleHash: '0x' + 'ff'.repeat(32), // deliberately wrong
    };

    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'cd'.repeat(32), reservationId },
      MINTER_TOKEN,
    );

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('bundle_hash_mismatch');
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — owner != caller (anti-front-run)
  // -------------------------------------------------------------------------

  it('/confirm: on-chain owner != caller walletAddress → 403', async () => {
    const mintRes = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(mintRes.status).toBe(200);

    const { reservationId, mintPayload } = mintRes.body;

    // Report a different on-chain owner
    const attacker = '0x' + 'ee'.repeat(20);
    mockMintTxResult = {
      tokenId: BigInt(1),
      owner: attacker, // different from MINTER_WALLET
      mode: 0,
      bundleHash: mintPayload.bundleHash,
    };

    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'ce'.repeat(32), reservationId },
      MINTER_TOKEN,
    );

    expect(r.status).toBe(403);
    expect(r.body.error).toBe('owner_mismatch');
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — expired reservation
  // -------------------------------------------------------------------------

  it('/confirm: expired reservation → 410', async () => {
    const { collections } = await import('../src/db/types.js');
    const { ObjectId } = await import('mongodb');

    // Insert an expired reservation directly
    const expiredId = '11111111-1111-4111-a111-111111111111';
    const pastDate = new Date(Date.now() - 1000);
    await tdb.db.collection(collections.mintReservations).insertOne({
      _id: new ObjectId(),
      reservedId: expiredId,
      userId: new ObjectId(),
      slug: 'expired-agent',
      manifestUri: 'mock://a',
      bundleUri: 'mock://b',
      sealedDEKBaseUri: 'mock://c',
      bundleHash: '0x' + '00'.repeat(32),
      status: 'uploaded',
      createdAt: pastDate,
      expiresAt: pastDate, // already expired
    });

    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'cf'.repeat(32), reservationId: expiredId },
      MINTER_TOKEN,
    );

    expect(r.status).toBe(410);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — already minted reservation
  // -------------------------------------------------------------------------

  it('/confirm: already-minted reservation → 410', async () => {
    const { collections } = await import('../src/db/types.js');
    const { ObjectId } = await import('mongodb');

    const mintedId = '22222222-2222-4222-a222-222222222222';
    const now = new Date();
    await tdb.db.collection(collections.mintReservations).insertOne({
      _id: new ObjectId(),
      reservedId: mintedId,
      userId: new ObjectId(),
      slug: 'already-minted',
      manifestUri: 'mock://a',
      bundleUri: 'mock://b',
      sealedDEKBaseUri: 'mock://c',
      bundleHash: '0x' + '00'.repeat(32),
      status: 'minted', // already consumed
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
    });

    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'd0'.repeat(32), reservationId: mintedId },
      MINTER_TOKEN,
    );

    expect(r.status).toBe(410);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — unknown reservationId
  // -------------------------------------------------------------------------

  it('/confirm: unknown reservationId → 410', async () => {
    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'd1'.repeat(32), reservationId: '33333333-3333-4333-a333-333333333333' },
      MINTER_TOKEN,
    );
    expect(r.status).toBe(410);
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — chain verification fails
  // -------------------------------------------------------------------------

  it('/confirm: chain error → 400', async () => {
    const mintRes = await jsonReq(app, 'POST', '/v1/agents/mint', validMintBody(), MINTER_TOKEN);
    expect(mintRes.status).toBe(200);

    const { reservationId } = mintRes.body;
    mockMintTxError = new Error('RPC timeout');

    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      { txHash: '0x' + 'd2'.repeat(32), reservationId },
      MINTER_TOKEN,
    );

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('chain_verification_failed');
  });

  // -------------------------------------------------------------------------
  // POST /v1/agents/mint/confirm — invalid txHash format
  // -------------------------------------------------------------------------

  it('/confirm: invalid txHash format → 400', async () => {
    const r = await jsonReq(
      app,
      'POST',
      '/v1/agents/mint/confirm',
      {
        txHash: 'not-a-hash',
        reservationId: '44444444-4444-4444-a444-444444444444',
      },
      MINTER_TOKEN,
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_body');
  });
});
