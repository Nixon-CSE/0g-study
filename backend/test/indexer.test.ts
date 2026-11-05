/**
 * Tests for ChainIndexer (Task J).
 *
 * All on-chain interaction is mocked so no real node is required.
 *
 * Scenarios covered:
 *   1. AgentMinted + matching reservation → AgentDoc inserted, reservation status → 'minted'
 *   2. AgentMinted with no matching reservation → no AgentDoc inserted, warning logged
 *   3. ModeChanged → logged; AgentDoc unchanged
 *   4. Idempotency: second AgentMinted for the same tokenId → still only one AgentDoc
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, type MockInstance } from 'vitest';
import { ObjectId } from 'mongodb';
import { ethers } from 'ethers';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { createIndexes } from '../src/db/indexes.js';
import { collections, type AgentDoc, type MintReservationDoc } from '../src/db/types.js';
import { ChainIndexer } from '../src/chain/indexer.js';
import type { IndexerDeps } from '../src/chain/indexer.js';
import { log } from '../src/util/logger.js';

// ---------------------------------------------------------------------------
// Minimal ABI fragment — enough for the indexer to parse the four events.
// ---------------------------------------------------------------------------

const INFT_ABI_FRAGMENT = [
  'event AgentMinted(uint256 indexed tokenId, address indexed owner, uint8 mode, bytes32 bundleHash)',
  'event ModeChanged(uint256 indexed tokenId, uint8 oldMode, uint8 newMode)',
  'event UsageAuthorized(uint256 indexed tokenId, address indexed executor, uint64 expiresAt)',
  'event UsageRevoked(uint256 indexed tokenId, address indexed executor)',
];

// ---------------------------------------------------------------------------
// Helper: build a fake ethers.Interface from the fragment above.
// ---------------------------------------------------------------------------

function buildFakeInterface(): ethers.Interface {
  return new ethers.Interface(INFT_ABI_FRAGMENT);
}

// ---------------------------------------------------------------------------
// Helper: encode a fake log for a given event.
// ---------------------------------------------------------------------------

function encodeLog(
  iface: ethers.Interface,
  eventName: string,
  values: unknown[],
  contractAddress = '0xCONTRACT0000000000000000000000000000000000',
): ethers.Log {
  const fragment = iface.getEvent(eventName);
  if (!fragment) throw new Error(`Event fragment not found: ${eventName}`);
  const encoded = iface.encodeEventLog(fragment, values);
  return {
    address: contractAddress,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: 100,
    blockHash: '0xblockhash',
    transactionHash: '0xtxhash',
    transactionIndex: 0,
    index: 0,
    removed: false,
  } as unknown as ethers.Log;
}

// ---------------------------------------------------------------------------
// Fake InftChain — provides readContract() returning a contract with our ABI.
// ---------------------------------------------------------------------------

type FakeInftChain = {
  readContract: () => { interface: ethers.Interface };
  agentOf: () => Promise<unknown>;
};

function makeFakeInftChain(): FakeInftChain {
  const iface = buildFakeInterface();
  return {
    readContract: () => ({ interface: iface }),
    agentOf: vi.fn().mockResolvedValue({
      owner: '0xOWNER',
      bundleHash: '0xbundlehash',
      manifestUri: 'mock://manifest',
      bundleUri: 'mock://bundle',
      sealedDEKBaseUri: 'mock://dek',
      mode: 0,
      createdAt: BigInt(0),
    }),
  };
}

// ---------------------------------------------------------------------------
// Fake ethers.JsonRpcProvider — returns scripted block number + logs.
// ---------------------------------------------------------------------------

interface FakeProviderOpts {
  currentBlock?: number;
  logs?: ethers.Log[];
}

function makeFakeProvider(opts: FakeProviderOpts = {}) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(opts.currentBlock ?? 100),
    getLogs: vi.fn().mockResolvedValue(opts.logs ?? []),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

const CONTRACT_ADDRESS = '0xCONTRACT0000000000000000000000000000000000';
const BUNDLE_HASH = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const OWNER_ADDRESS = '0xdeadbeef00000000000000000000000000000001';

function makeReservation(overrides: Partial<MintReservationDoc> = {}): MintReservationDoc {
  return {
    _id: new ObjectId(),
    reservedId: 'test-reserved-id',
    userId: new ObjectId(),
    slug: 'test-agent',
    manifestUri: 'mock://manifest/1',
    bundleUri: 'mock://bundle/1',
    sealedDEKBaseUri: 'mock://dek/1',
    bundleHash: BUNDLE_HASH,
    status: 'uploaded',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  } as MintReservationDoc;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChainIndexer — poll path', () => {
  let tdb: TestDb;
  let fakeInft: FakeInftChain;
  let iface: ethers.Interface;

  beforeAll(async () => {
    tdb = await startTestDb();
    await createIndexes(tdb.db);
  });

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await cleanCollections(tdb.db);
    await createIndexes(tdb.db);
    fakeInft = makeFakeInftChain();
    iface = buildFakeInterface();
  });

  // -------------------------------------------------------------------------
  // Utility: run one poll tick synchronously using a controlled fake provider.
  // -------------------------------------------------------------------------

  async function runOnePollTick(logs: ethers.Log[]): Promise<void> {
    const fakeProvider = makeFakeProvider({ currentBlock: 200, logs });

    const deps: IndexerDeps = {
      db: tdb.db,
      inft: fakeInft as unknown as import('../src/chain/inft.js').InftChain,
      contractAddress: CONTRACT_ADDRESS,
      rpcUrl: 'http://fake-rpc',
      startBlock: 100, // cursor starts here; poll range = 101–200
    };

    const indexer = new ChainIndexer(deps);

    // Patch the private httpProvider with our fake — avoids real HTTP calls.
    // We use Object.defineProperty to bypass TS's private modifier at runtime.
    Object.defineProperty(indexer, 'httpProvider', { value: fakeProvider, writable: true });

    // Simulate start without websocket (will skip WSS because rpcUrl is http://)
    // Drive the poll logic directly to avoid timer-based async complexity in tests.
    // @ts-expect-error — accessing private method for test purposes
    await indexer['startPollingOnce'](fakeProvider);
  }

  // Expose a test-friendly single-tick method without timers.
  // We inline the poll logic here rather than relying on private method access.
  async function pollOnce(logs: ethers.Log[], startBlock = 100): Promise<void> {
    const fakeProvider = makeFakeProvider({ currentBlock: 200, logs });

    // Build a minimal indexer and drive dispatchEvent directly.
    const deps: IndexerDeps = {
      db: tdb.db,
      inft: fakeInft as unknown as import('../src/chain/inft.js').InftChain,
      contractAddress: CONTRACT_ADDRESS,
      rpcUrl: 'http://fake-rpc',
      startBlock,
    };

    const indexer = new ChainIndexer(deps);

    // Drive events through dispatchEvent without starting the timer loop.
    for (const rawLog of logs) {
      let parsed: ethers.LogDescription | null = null;
      try {
        parsed = iface.parseLog({ topics: rawLog.topics as string[], data: rawLog.data });
      } catch {
        continue;
      }
      if (!parsed) continue;

      // Access private dispatchEvent via bracket notation for test purposes.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (indexer as any).dispatchEvent(parsed.name, parsed.args);
    }
  }

  // -------------------------------------------------------------------------
  // Test 1: AgentMinted + matching reservation → AgentDoc inserted
  // -------------------------------------------------------------------------

  it('inserts AgentDoc when AgentMinted event matches a MintReservationDoc', async () => {
    // Insert a reservation that the indexer should find by bundleHash.
    const reservation = makeReservation();
    await tdb.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .insertOne(reservation);

    const tokenId = BigInt(42);
    const agentMintedLog = encodeLog(
      iface,
      'AgentMinted',
      [tokenId, OWNER_ADDRESS, 0, BUNDLE_HASH],
      CONTRACT_ADDRESS,
    );

    await pollOnce([agentMintedLog]);

    const inserted = await tdb.db
      .collection<AgentDoc>(collections.agents)
      .findOne({ tokenId: '42' });

    expect(inserted).not.toBeNull();
    expect(inserted!.slug).toBe('test-agent');
    // ethers checksums the address during ABI decode — compare case-insensitively.
    expect(inserted!.ownerWallet!.toLowerCase()).toBe(OWNER_ADDRESS.toLowerCase());
    expect(inserted!.bundleHash).toBe(BUNDLE_HASH);
    expect(inserted!.contractAddress).toBe(CONTRACT_ADDRESS);

    // Reservation status should be updated to 'minted'.
    const updatedReservation = await tdb.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .findOne({ _id: reservation._id });
    expect(updatedReservation!.status).toBe('minted');
  });

  // -------------------------------------------------------------------------
  // Test 2: AgentMinted with no matching reservation → no AgentDoc, warn logged
  // -------------------------------------------------------------------------

  it('skips AgentDoc insertion and logs a warning when no reservation matches', async () => {
    // No reservation inserted — bundleHash will not match anything.
    const warnSpy: MockInstance = vi.spyOn(log, 'warn');

    const tokenId = BigInt(99);
    const unknownBundleHash =
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const agentMintedLog = encodeLog(
      iface,
      'AgentMinted',
      [tokenId, OWNER_ADDRESS, 0, unknownBundleHash],
      CONTRACT_ADDRESS,
    );

    await pollOnce([agentMintedLog]);

    // No AgentDoc should have been inserted.
    const count = await tdb.db.collection(collections.agents).countDocuments();
    expect(count).toBe(0);

    // Warning must have been logged.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tokenStr: '99' }),
      expect.stringContaining('no matching reservation'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 3: ModeChanged → logged only (no AgentDoc mutation)
  // -------------------------------------------------------------------------

  it('logs ModeChanged without mutating AgentDoc', async () => {
    const infoSpy: MockInstance = vi.spyOn(log, 'info');

    const agentId = new ObjectId();
    const agentDoc: AgentDoc = {
      _id: agentId,
      slug: 'mode-test-agent',
      name: 'Mode Test Agent',
      description: '',
      bio: null,
      avatarUrl: null,
      tags: [],
      baseUrl: 'http://localhost:7777',
      visibility: 'public',
      agentKeyHash: null,
      tokenId: '7',
      contractAddress: CONTRACT_ADDRESS,
      ownerWallet: OWNER_ADDRESS,
      manifestUri: 'mock://m',
      bundleUri: 'mock://b',
      sealedDEKBaseUri: 'mock://d',
      bundleHash: BUNDLE_HASH,
      createdBy: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await tdb.db.collection<AgentDoc>(collections.agents).insertOne(agentDoc);

    const modeChangedLog = encodeLog(
      iface,
      'ModeChanged',
      [BigInt(7), 0, 1],
      CONTRACT_ADDRESS,
    );

    await pollOnce([modeChangedLog]);

    const updated = await tdb.db
      .collection<AgentDoc>(collections.agents)
      .findOne({ tokenId: '7' });

    expect(updated!.updatedAt.getTime()).toBe(agentDoc.updatedAt.getTime());
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tokenStr: '7', newMode: 1 }),
      expect.stringContaining('ModeChanged'),
    );

    infoSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 4: Idempotency — second AgentMinted for the same tokenId → no duplicate
  // -------------------------------------------------------------------------

  it('does not insert a duplicate AgentDoc if AgentMinted fires twice for the same tokenId', async () => {
    const reservation = makeReservation();
    await tdb.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .insertOne(reservation);

    const tokenId = BigInt(55);
    const agentMintedLog = encodeLog(
      iface,
      'AgentMinted',
      [tokenId, OWNER_ADDRESS, 0, BUNDLE_HASH],
      CONTRACT_ADDRESS,
    );

    // First fire — should insert.
    await pollOnce([agentMintedLog]);

    // Second fire — should be a no-op (idempotency guard).
    await pollOnce([agentMintedLog]);

    const count = await tdb.db
      .collection(collections.agents)
      .countDocuments({ tokenId: '55' });

    expect(count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 5: UsageAuthorized / UsageRevoked — logs info, no DB mutation
  // -------------------------------------------------------------------------

  it('logs info for UsageAuthorized without throwing', async () => {
    const infoSpy: MockInstance = vi.spyOn(log, 'info');

    const authLog = encodeLog(
      iface,
      'UsageAuthorized',
      [BigInt(11), OWNER_ADDRESS, BigInt(9999999999)],
      CONTRACT_ADDRESS,
    );

    await pollOnce([authLog]);

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tokenId: '11' }),
      expect.stringContaining('UsageAuthorized/Revoked'),
    );

    infoSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Test 6: AgentMinted with chain mode=1 (still indexed like mode=0 for app semantics)
  // -------------------------------------------------------------------------

  it('inserts AgentDoc when AgentMinted fires with on-chain mode=1', async () => {
    // Use a valid 32-byte (64 hex char) hash distinct from BUNDLE_HASH.
    const reservation = makeReservation({ bundleHash: '0x1111111111111111111111111111111111111111111111111111111111111111' });
    await tdb.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .insertOne(reservation);

    const tokenId = BigInt(77);
    const agentMintedLog = encodeLog(
      iface,
      'AgentMinted',
      [tokenId, OWNER_ADDRESS, 1, '0x1111111111111111111111111111111111111111111111111111111111111111'],
      CONTRACT_ADDRESS,
    );

    await pollOnce([agentMintedLog]);

    const inserted = await tdb.db
      .collection<AgentDoc>(collections.agents)
      .findOne({ tokenId: '77' });

    expect(inserted).not.toBeNull();
    expect(inserted!.slug).toBe('test-agent');
    expect(inserted).not.toHaveProperty('mode');
  });
});
