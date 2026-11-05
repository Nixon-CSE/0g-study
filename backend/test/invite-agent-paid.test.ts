/**
 * Tests for POST /v1/servers/:sid/invite-agent
 *
 * Payment verification is mocked — we don't hit a real 0G RPC in unit tests.
 * The mock is injected via vi.mock for the payments module.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { collections } from '../src/db/types.js';

// ---------------------------------------------------------------------------
// Mock the payments module so tests don't hit a real RPC node.
// The mock is overridden per-test via mockImplementation.
// ---------------------------------------------------------------------------

const mockVerify = vi.fn();

vi.mock('../src/servers/payments.js', () => ({
  PaymentVerificationError: class PaymentVerificationError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'PaymentVerificationError';
      this.code = code;
    }
  },
  verifyAgentInvitePayment: (...args: unknown[]) => mockVerify(...args),
}));

// ---------------------------------------------------------------------------
// Helper: seed an agent with optional priceOg / ownerWallet.
// ---------------------------------------------------------------------------

async function seedAgent(db: any, opts: {
  slug?: string;
  priceOg?: string;
  ownerWallet?: string;
} = {}) {
  const doc = {
    _id: new ObjectId(),
    name: opts.slug ?? 'TestBot',
    slug: opts.slug ?? 'test-bot',
    avatarUrl: null,
    description: 'test agent',
    bio: null,
    tags: [],
    baseUrl: 'http://agent.test:7777',
    visibility: 'public' as const,
    createdBy: new ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...(opts.priceOg !== undefined ? { priceOg: opts.priceOg } : {}),
    ...(opts.ownerWallet !== undefined ? { ownerWallet: opts.ownerWallet } : {}),
  };
  await db.collection(collections.agents).insertOne(doc);
  return doc;
}

const VALID_TX = '0x' + 'a'.repeat(64);
const VALID_WALLET = '0x' + 'b'.repeat(40);

describe('POST /v1/servers/:sid/invite-agent', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => { tdb = await startTestDb(); });
  afterAll(async () => { await stopTestDb(); });
  beforeEach(async () => {
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
    mockVerify.mockReset();
  });

  // ── free agent ─────────────────────────────────────────────────────────────

  it('free invite succeeds without paymentTxHash → 201', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-fi' });
    const agent = await seedAgent(tdb.db, { slug: 'free-bot' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-fi' }, alice.token);

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'free-bot' }, alice.token);
    expect(r.status).toBe(201);
    expect(r.body.member.principalType).toBe('agent');
    expect(r.body.member.principalId).toBe(agent._id.toHexString());
  });

  it('free invite (priceOg="0") succeeds without payment', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-fi2' });
    await seedAgent(tdb.db, { slug: 'zero-price-bot', priceOg: '0' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-fi2' }, alice.token);

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'zero-price-bot' }, alice.token);
    expect(r.status).toBe(201);
  });

  // ── priced agent — missing txHash ──────────────────────────────────────────

  it('priced invite without paymentTxHash → 402', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-pr' });
    await seedAgent(tdb.db, { slug: 'paid-bot', priceOg: '1.0', ownerWallet: VALID_WALLET });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-pr' }, alice.token);

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'paid-bot' }, alice.token);
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('payment_required');
  });

  // ── priced agent — bad txHash (verification fails) ────────────────────────

  it('priced invite with bad txHash → 400 payment_invalid', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-bad' });
    await seedAgent(tdb.db, { slug: 'paid-bot2', priceOg: '1.0', ownerWallet: VALID_WALLET });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-bad' }, alice.token);

    // Make the mock throw a PaymentVerificationError
    const { PaymentVerificationError } = await import('../src/servers/payments.js');
    mockVerify.mockRejectedValueOnce(new PaymentVerificationError('wrong_amount', 'Value mismatch'));

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'paid-bot2', paymentTxHash: VALID_TX }, alice.token);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('payment_invalid');
    expect(r.body.code).toBe('wrong_amount');
  });

  // ── priced agent — happy path ──────────────────────────────────────────────

  it('happy path: valid payment → 201 with paidTxHash stored', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-hp' });
    const agent = await seedAgent(tdb.db, { slug: 'paid-bot3', priceOg: '0.5', ownerWallet: VALID_WALLET });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-hp' }, alice.token);

    mockVerify.mockResolvedValueOnce({ ok: true, from: '0xuser' });

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'paid-bot3', paymentTxHash: VALID_TX }, alice.token);
    expect(r.status).toBe(201);
    expect(r.body.member.principalId).toBe(agent._id.toHexString());

    // Verify paidTxHash was persisted
    const row = await tdb.db.collection(collections.serverMembers)
      .findOne({ principalId: agent._id });
    expect(row?.paidTxHash).toBe(VALID_TX);
    expect(row?.paidAmount).toBe('0.5');
  });

  // ── duplicate-tx guard ────────────────────────────────────────────────────

  it('reusing the same txHash for a second invite → 409 payment_already_used', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-dup' });
    await seedAgent(tdb.db, { slug: 'paid-bot4', priceOg: '0.5', ownerWallet: VALID_WALLET });
    await seedAgent(tdb.db, { slug: 'paid-bot5', priceOg: '0.5', ownerWallet: VALID_WALLET });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-dup' }, alice.token);

    mockVerify.mockResolvedValue({ ok: true, from: '0xuser' });

    // First invite — should succeed
    const r1 = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'paid-bot4', paymentTxHash: VALID_TX }, alice.token);
    expect(r1.status).toBe(201);

    // Second invite with the same txHash (different agent) — should be blocked
    const r2 = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'paid-bot5', paymentTxHash: VALID_TX }, alice.token);
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe('payment_already_used');
  });

  // ── duplicate-member guard ───────────────────────────────────────────────

  it('inviting an agent that is already a member → 409 agent_already_in_server', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-dup2' });
    await seedAgent(tdb.db, { slug: 'free-dup-bot' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-dup2' }, alice.token);

    const r1 = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'free-dup-bot' }, alice.token);
    expect(r1.status).toBe(201);

    const r2 = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'free-dup-bot' }, alice.token);
    expect(r2.status).toBe(409);
    expect(r2.body.error).toBe('agent_already_in_server');
  });

  // ── non-member cannot invite ───────────────────────────────────────────────

  it('unauthenticated user cannot invite → 401', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-noauth' });
    await seedAgent(tdb.db, { slug: 'noauth-bot' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-noauth' }, alice.token);

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'noauth-bot' });
    expect(r.status).toBe(401);
  });

  // ── agent not found ────────────────────────────────────────────────────────

  it('non-existent agentSlug → 404', async () => {
    const alice = await registerAndLogin(app, { username: 'alice-404' });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: 'A', slug: 'a-404' }, alice.token);

    const r = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/invite-agent`,
      { agentSlug: 'does-not-exist' }, alice.token);
    expect(r.status).toBe(404);
  });
});
