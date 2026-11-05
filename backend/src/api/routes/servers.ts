import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { requireUser } from '../../auth/middleware.js';
import { requireServerMember, type ServerBindings } from '../../servers/middleware.js';
import type { AgentDoc, ChannelDoc } from '../../db/types.js';
import { collections } from '../../db/types.js';
import {
  SlugTakenError, createServer, listServersForUser, publicServer,
  listServerMembers, publicMember, addMember, ownerWallet,
} from '../../servers/service.js';
import { publicChannel } from '../../channels/service.js';
import { fetchOnchainBalance, withdrawFromServerWallet } from '../../servers/wallet.js';
import { verifyAgentInvitePayment, PaymentVerificationError } from '../../servers/payments.js';
import { log } from '../../util/logger.js';

const SLUG_RE = /^[a-z0-9_-]{1,32}$/;

const CreateServerBody = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().regex(SLUG_RE),
  iconUrl: z.string().url().nullish(),
});

const PatchServerBody = z.object({
  name: z.string().min(1).max(64).optional(),
  iconUrl: z.string().url().nullable().optional(),
});

export interface ServerRouteDeps { db: Db; jwtSecret: string; }

export function serverRoutes(deps: ServerRouteDeps) {
  const app = new Hono<ServerBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.post('/v1/servers', requireAuth, async (c) => {
    const parsed = CreateServerBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    try {
      const { server } = await createServer(deps.db, {
        name: parsed.data.name,
        slug: parsed.data.slug,
        iconUrl: parsed.data.iconUrl ?? null,
        ownerId: c.get('user')._id,
      });
      return c.json({
        server: publicServer(server),
        wallet: ownerWallet(server.wallet!),
        funding: {
          faucetUrl: 'https://faucet.0g.ai',
          rpcUrl: 'https://evmrpc-testnet.0g.ai',
          chainId: 16602,
          minRecommendedBalance: '4',
          tokenSymbol: 'OG',
          note: 'Fund this address with at least 4 OG. The 0G ledger requires a 3 OG minimum + gas reserve.',
        },
      }, 201);
    } catch (e) {
      if (e instanceof SlugTakenError) return c.json({ error: 'slug_taken' }, 409);
      throw e;
    }
  });

  app.get('/v1/servers', requireAuth, async (c) => {
    const servers = await listServersForUser(deps.db, c.get('user')._id);
    return c.json({ servers: servers.map(publicServer) });
  });

  app.get('/v1/servers/:sid', requireAuth, requireServerMember(deps.db), (c) => {
    return c.json({ server: publicServer(c.get('server')) });
  });

  app.patch('/v1/servers/:sid', requireAuth, requireServerMember(deps.db, 'admin'), async (c) => {
    const parsed = PatchServerBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) $set.name = parsed.data.name;
    if (parsed.data.iconUrl !== undefined) $set.iconUrl = parsed.data.iconUrl;
    const res = await deps.db.collection(collections.servers).findOneAndUpdate(
      { _id: c.get('server')._id }, { $set }, { returnDocument: 'after' }
    );
    if (!res) return c.json({ error: 'not_found' }, 404);
    return c.json({ server: publicServer(res as any) });
  });

  app.delete('/v1/servers/:sid', requireAuth, requireServerMember(deps.db, 'owner'), async (c) => {
    const serverId = c.get('server')._id;
    await deps.db.collection(collections.messages).deleteMany({ serverId });
    await deps.db.collection(collections.channels).deleteMany({ serverId });
    await deps.db.collection(collections.serverMembers).deleteMany({ serverId });
    await deps.db.collection(collections.servers).deleteOne({ _id: serverId });
    return c.json({ ok: true });
  });

  app.get('/v1/servers/:sid/members', requireAuth, requireServerMember(deps.db), async (c) => {
    const typeParam = c.req.query('type');
    const type = typeParam === 'user' || typeParam === 'agent' ? typeParam : undefined;
    const members = await listServerMembers(deps.db, c.get('server')._id, type);

    // Join with users to surface real username/displayName/avatarUrl on user-type
    // memberships — frontend previously fell back to rendering principalId (hex)
    // which read like a Privy DID.
    const userIds = members
      .filter((m) => m.principalType === 'user')
      .map((m) => m.principalId);
    type UserMini = { _id: ObjectId; username?: string; displayName?: string; avatarUrl?: string | null };
    const userDocs = userIds.length === 0
      ? []
      : await deps.db.collection<UserMini>(collections.users)
          .find({ _id: { $in: userIds } }, { projection: { username: 1, displayName: 1, avatarUrl: 1 } })
          .toArray();
    const byId = new Map(userDocs.map((u) => [u._id.toHexString(), u]));

    const enriched = members.map((m) => {
      const base = publicMember(m);
      if (m.principalType !== 'user') return base;
      const u = byId.get(m.principalId.toHexString());
      if (!u) return base;
      return {
        ...base,
        username: u.username ?? null,
        displayName: u.displayName ?? null,
        avatarUrl: u.avatarUrl ?? null,
      };
    });
    return c.json({ members: enriched });
  });

  app.get('/v1/servers/:sid/channels', requireAuth, requireServerMember(deps.db), async (c) => {
    const channels = await deps.db.collection<ChannelDoc>(collections.channels)
      .find({ serverId: c.get('server')._id })
      .sort({ position: 1 })
      .toArray();
    // Use the shared publicChannel() so this stays in sync with POST /channels
    // (tee, teeAttestationHash, cascadeEnabled — otherwise the list view drifts
    // and a freshly-created TEE channel shows up as a normal one after refresh).
    return c.json({ channels: channels.map(publicChannel) });
  });

  const AddMemberBody = z.object({
    principalType: z.enum(['user', 'agent']),
    principalId: z.string().regex(/^[a-f0-9]{24}$/i),
    role: z.enum(['admin', 'member']).optional(),
    alias: z.string().max(64).nullish(),
  });

  app.post('/v1/servers/:sid/members', requireAuth, requireServerMember(deps.db, 'admin'), async (c) => {
    const parsed = AddMemberBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    const principalId = new ObjectId(parsed.data.principalId);

    const targetCollection = parsed.data.principalType === 'user' ? collections.users : collections.agents;
    const exists = await deps.db.collection(targetCollection).findOne({ _id: principalId });
    if (!exists) return c.json({ error: 'principal_not_found' }, 404);

    const dup = await deps.db.collection(collections.serverMembers).findOne({
      serverId: c.get('server')._id,
      principalType: parsed.data.principalType,
      principalId,
    });
    if (dup) return c.json({ error: 'already_a_member' }, 409);

    const added = await addMember(deps.db, {
      serverId: c.get('server')._id,
      principalType: parsed.data.principalType,
      principalId,
      role: parsed.data.role ?? 'member',
      alias: parsed.data.alias ?? null,
    });
    return c.json({ member: publicMember(added) }, 201);
  });

  app.get('/v1/servers/:sid/wallet', requireAuth, requireServerMember(deps.db, 'admin'), async (c) => {
    const server = c.get('server');
    if (!server.wallet) return c.json({ error: 'no_wallet' }, 404);

    let balance: string | null = null;
    let balanceError: string | null = null;
    try {
      const rpcUrl = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
      balance = await fetchOnchainBalance(rpcUrl, server.wallet.address);
    } catch (e: any) {
      balanceError = e?.message ?? String(e);
    }

    return c.json({
      wallet: ownerWallet(server.wallet),
      balance,
      balanceError,
      funding: {
        faucetUrl: 'https://faucet.0g.ai',
        rpcUrl: process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai',
        tokenSymbol: 'OG',
      },
    });
  });

  const WithdrawBody = z.object({
    toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amount: z.string().regex(/^\d+(\.\d+)?$/),
  });

  app.post('/v1/servers/:sid/wallet/withdraw', requireAuth, requireServerMember(deps.db, 'owner'), async (c) => {
    const server = c.get('server');
    if (!server.wallet) return c.json({ error: 'no_wallet' }, 404);
    const parsed = WithdrawBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    const rpcUrl = process.env.OG_RPC_URL || 'https://evmrpc-testnet.0g.ai';
    try {
      const result = await withdrawFromServerWallet({
        rpcUrl,
        privateKey: server.wallet.privateKey,
        toAddress: parsed.data.toAddress,
        amountOg: parsed.data.amount,
      });
      return c.json(result);
    } catch (e: any) {
      const code = e?.code;
      if (code === 'invalid_to_address' || code === 'invalid_amount') return c.json({ error: code }, 400);
      if (code === 'insufficient_balance') return c.json({ error: code, message: e.message }, 400);
      throw e;
    }
  });

  const InviteAgentBody = z.object({
    agentSlug: z.string().min(1).max(64),
    paymentTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  });

  app.post('/v1/servers/:sid/invite-agent', requireAuth, requireServerMember(deps.db, 'admin'), async (c) => {
    const parsed = InviteAgentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    const { agentSlug, paymentTxHash } = parsed.data;

    // 1. Look up the agent by slug
    const agent = await deps.db.collection<AgentDoc>(collections.agents).findOne(
      { slug: agentSlug.toLowerCase() },
      { collation: { locale: 'en', strength: 2 } },
    );
    if (!agent) return c.json({ error: 'not_found' }, 404);

    // 2. Check if agent is already a member
    const dup = await deps.db.collection(collections.serverMembers).findOne({
      serverId: c.get('server')._id,
      principalType: 'agent',
      principalId: agent._id,
    });
    if (dup) return c.json({ error: 'agent_already_in_server' }, 409);

    // 3. Handle paid invites
    const priceOg = agent.priceOg ?? '0';
    const isPaid = parseFloat(priceOg) > 0;

    if (isPaid) {
      // Require a txHash
      if (!paymentTxHash) return c.json({ error: 'payment_required', priceOg }, 402);

      // Require an ownerWallet
      if (!agent.ownerWallet) return c.json({ error: 'agent_has_no_owner_wallet' }, 400);

      // Require the authenticated user to have a wallet (for the from-check).
      const buyer = c.get('user');
      if (!buyer.walletAddress) return c.json({ error: 'user_has_no_wallet' }, 400);

      // Verify the payment on-chain. The from-check rejects replays of any
      // historical transfer to ownerWallet that the buyer didn't actually send.
      try {
        await verifyAgentInvitePayment({
          txHash: paymentTxHash,
          expectedFrom: buyer.walletAddress,
          toAddress: agent.ownerWallet,
          expectedOgAmount: priceOg,
        });
      } catch (e) {
        if (e instanceof PaymentVerificationError) {
          log.warn({ txHash: paymentTxHash, code: e.code, agentSlug }, 'agent invite payment verification failed');
          // Map insufficient_confirmations to 425 (Too Early) so the frontend
          // can retry after a short backoff instead of treating it as fatal.
          if (e.code === 'insufficient_confirmations') {
            return c.json({ error: 'insufficient_confirmations', message: e.message }, 425);
          }
          return c.json({ error: 'payment_invalid', code: e.code, message: e.message }, 400);
        }
        throw e;
      }
    }

    // 4. Add the agent as a member. The uniqueness on serverMembers.paidTxHash
    // (sparse) is the authoritative replay guard — it eliminates the
    // TOCTOU window a pre-check would have. On collision Mongo raises
    // 11000; we translate to 409 payment_already_used.
    let member;
    try {
      member = await addMember(deps.db, {
        serverId: c.get('server')._id,
        principalType: 'agent',
        principalId: agent._id,
        role: 'member',
        alias: null,
        ...(isPaid && paymentTxHash ? {
          paidTxHash: paymentTxHash,
          paidAmount: priceOg,
          paidByUserId: c.get('user')._id,
        } : {}),
      });
    } catch (e) {
      const err = e as { code?: number; keyPattern?: Record<string, unknown> };
      if (err.code === 11000 && err.keyPattern && 'paidTxHash' in err.keyPattern) {
        return c.json({ error: 'payment_already_used' }, 409);
      }
      throw e;
    }

    return c.json({ member: publicMember(member) }, 201);
  });

  app.delete('/v1/servers/:sid/members/:mid', requireAuth, requireServerMember(deps.db), async (c) => {
    const mid = c.req.param('mid');
    if (!ObjectId.isValid(mid)) return c.json({ error: 'invalid_member_id' }, 400);
    const memberId = new ObjectId(mid);

    const target = await deps.db.collection(collections.serverMembers).findOne({ _id: memberId, serverId: c.get('server')._id });
    if (!target) return c.json({ error: 'not_found' }, 404);

    const me = c.get('membership');
    const selfLeave = target.principalType === 'user' && target.principalId.equals(c.get('user')._id);
    const isAdmin = me.role === 'owner' || me.role === 'admin';
    if (!selfLeave && !isAdmin) return c.json({ error: 'forbidden' }, 403);
    if (target.role === 'owner') return c.json({ error: 'cannot_remove_owner' }, 400);

    await deps.db.collection(collections.serverMembers).deleteOne({ _id: memberId });
    return c.json({ ok: true });
  });

  return app;
}
