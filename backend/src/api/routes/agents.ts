import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import type { Db } from 'mongodb';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { keccak256, parseEther, formatEther } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { requireUser, type AuthBindings } from '../../auth/middleware.js';
import {
  AgentSlugTakenError, createAgent, findAgentByIdOrSlug,
  listPublicAgents, deleteAgent, publicAgent, rotateAgentKey,
} from '../../agents/registry.js';
import { collections } from '../../db/types.js';
import { agentFetch, maskMcpServers } from '../../agents/admin-token.js';
import type { AgentDoc, MintReservationDoc, UserDoc } from '../../db/types.js';

/**
 * DEMO MODE: ownership gating disabled — any authenticated user can manage
 * any agent (install skills, edit MCP, etc.). The auth middleware still runs
 * upstream, so unauthenticated requests are still rejected at the edge.
 *
 * Re-enable by restoring the createdBy / ownerWallet checks below.
 */
/**
 * Who may edit, delete, rotate the key of, or change skills/MCP on an agent:
 * the user who registered it, or — for INFT agents — the user whose wallet owns the token on-chain.
 */
export function canManageAgent(a: AgentDoc, user: UserDoc): boolean {
  if (a.createdBy && a.createdBy.equals(user._id)) return true;
  if (a.ownerWallet && user.walletAddress && a.ownerWallet.toLowerCase() === user.walletAddress.toLowerCase()) return true;
  return false;
}
import { encryptAesGcm, packEnvelope, sealEcies, pubkeyFromPrivkey } from '../../crypto/index.js';
import { createOgStorage } from '../../storage-0g/index.js';
import { createInftChain } from '../../chain/index.js';

const SLUG_RE = /^[a-z0-9_-]{1,32}$/;

const TenantLlmOverrideSchema = z.object({
  provider: z.enum(['openai-compatible', 'zerog', 'zerog-router']).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
});

const CreateAgentBody = z.object({
  name: z.string().min(1).max(64),
  slug: z.string().regex(SLUG_RE),
  baseUrl: z.string().url(),
  description: z.string().min(1).max(200),
  bio: z.string().max(10_000).nullish(),
  avatarUrl: z.string().url().nullish(),
  tags: z.array(z.string().min(1).max(32)).max(16).optional(),
  soul: z.string().max(10_000).optional(),
  agents: z.string().max(10_000).optional(),
  env: z.record(z.string(), z.string()).optional(),
  llm: TenantLlmOverrideSchema.optional(),
});

const PatchAgentBody = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().min(1).max(200).optional(),
  bio: z.string().max(10_000).nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string().min(1).max(32)).max(16).optional(),
  baseUrl: z.string().url().optional(),
  soul: z.string().max(10_000).optional(),
  agents: z.string().max(10_000).optional(),
  env: z.record(z.string(), z.string()).optional(),
  llm: TenantLlmOverrideSchema.optional(),
  priceOg: z.string().regex(/^\d+(\.\d+)?$/).optional(),
});

export interface AgentRouteDeps { db: Db; jwtSecret: string; }

export function agentRoutes(deps: AgentRouteDeps) {
  const app = new Hono<AuthBindings>();
  const requireAuth = requireUser(deps.db, deps.jwtSecret);

  app.get('/v1/agents', async (c) => {
    const q = c.req.query('q');
    const tag = c.req.query('tag');
    const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined;
    const cursor = c.req.query('cursor') ?? undefined;
    const agents = await listPublicAgents(deps.db, { q, tag, limit, cursor });
    return c.json({ agents: agents.map(publicAgent) });
  });

  app.get('/v1/agents/:aid', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    return c.json({ agent: publicAgent(a) });
  });

  /**
   * GET /v1/agents/:aid/manifest
   *
   * Fetches the agent's public manifest JSON from 0G Storage.
   * The manifest is plaintext — safe to expose publicly.
   */
  app.get('/v1/agents/:aid/manifest', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!a.manifestUri) return c.json({ error: 'not_minted' }, 404);
    try {
      const storage = createOgStorage();
      const buf = await storage.fetch(a.manifestUri);
      const manifest = JSON.parse(buf.toString('utf8'));
      return c.json({ manifest });
    } catch (e: any) {
      return c.json({ error: 'fetch_failed', message: e?.message ?? String(e) }, 502);
    }
  });

  /**
   * GET /v1/agents/:aid/config
   *
   * Proxies a safe subset of the agent runtime's /config (llm model, provider,
   * temperature). Swallows errors so unreachable agents return nulls gracefully.
   */
  app.get('/v1/agents/:aid/config', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    try {
      const [cfgRes, tenantRes] = await Promise.allSettled([
        agentFetch(`${a.baseUrl}/config`).then(r => r.json() as Promise<Record<string, unknown>>),
        agentFetch(`${a.baseUrl}/tenants/${a.slug}`).then(r => r.json() as Promise<Record<string, unknown>>),
      ]);
      const cfg = cfgRes.status === 'fulfilled' ? cfgRes.value : {};
      const tenantData = tenantRes.status === 'fulfilled' ? tenantRes.value : {};
      const tenant = (tenantData as Record<string, unknown>)?.tenant as Record<string, unknown> | undefined;
      const globalLlm = cfg?.llm as Record<string, unknown> | undefined;
      const tenantLlm = tenant?.llm as Record<string, unknown> | undefined;
      const provider = ((tenantLlm?.provider ?? globalLlm?.provider) as string | undefined) ?? null;
      const rawModel = ((tenantLlm?.model ?? globalLlm?.model) as string | undefined) ?? null;
      const model = rawModel ?? (provider === 'zerog' ? '0G Compute (auto)' : null);
      return c.json({
        model,
        provider,
        temperature: ((tenantLlm?.temperature ?? globalLlm?.temperature) as number | undefined) ?? null,
      });
    } catch {
      return c.json({ model: null, provider: null, temperature: null });
    }
  });

  /**
   * GET /v1/agents/:aid/earnings
   *
   * Returns the agent's lifetime invite earnings — every paid `serverMember`
   * row whose `principalId === agent._id` contributes one event. The amount
   * is the per-server invite price the buyer paid (decimal OG string).
   *
   * Public: anyone can see what an agent has earned (marketplace transparency).
   */
  app.get('/v1/agents/:aid/earnings', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);

    const rows = await deps.db.collection(collections.serverMembers)
      .find({ principalType: 'agent', principalId: a._id, paidAmount: { $exists: true } })
      .sort({ joinedAt: -1 })
      .toArray();

    let totalWei = 0n;
    const events = rows.map((r) => {
      let amountWei = 0n;
      try { amountWei = parseEther(String(r.paidAmount ?? '0')); } catch { /* ignore */ }
      totalWei += amountWei;
      return {
        serverId: r.serverId.toHexString(),
        amount: String(r.paidAmount ?? '0'),
        txHash: r.paidTxHash ?? null,
        paidByUserId: r.paidByUserId?.toHexString?.() ?? null,
        joinedAt: r.joinedAt instanceof Date ? r.joinedAt.toISOString() : new Date(r.joinedAt).toISOString(),
      };
    });

    return c.json({
      agentSlug: a.slug,
      ownerWallet: a.ownerWallet ?? null,
      priceOg: a.priceOg ?? '0',
      totalEarnedOg: formatEther(totalWei),
      paidInviteCount: rows.length,
      events,
    });
  });

  app.post('/v1/agents', requireAuth, async (c) => {
    const parsed = CreateAgentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    // If soul/agents/env/llm provided, create the tenant on the agent first.
    const hasAgentSidePayload = !!(
      parsed.data.soul || parsed.data.agents || parsed.data.env || parsed.data.llm
    );
    if (hasAgentSidePayload) {
      try {
        const tenantBody: Record<string, unknown> = {
          slug: parsed.data.slug.toLowerCase(),
          name: parsed.data.name,
          description: parsed.data.description,
          soul: parsed.data.soul ?? '',
          agents: parsed.data.agents ?? '',
          tags: parsed.data.tags ?? [],
          avatarUrl: parsed.data.avatarUrl ?? null,
        };
        if (parsed.data.env) tenantBody.env = parsed.data.env;
        if (parsed.data.llm) tenantBody.llm = parsed.data.llm;
        const tenantRes = await agentFetch(`${parsed.data.baseUrl}/tenants`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(tenantBody),
        });
        if (!tenantRes.ok && tenantRes.status !== 409) {
          // 409 = slug already exists on agent (idempotent; treat as ok)
          const body = await tenantRes.text();
          return c.json({ error: 'agent_tenant_create_failed', status: tenantRes.status, body }, 502);
        }
      } catch (e: any) {
        return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
      }
    }

    try {
      const { agent, agentKey } = await createAgent(deps.db, { ...parsed.data, createdBy: c.get('user')._id });
      return c.json({ agent: publicAgent(agent), agentKey }, 201);
    } catch (e) {
      if (e instanceof AgentSlugTakenError) return c.json({ error: 'agent_slug_taken' }, 409);
      throw e;
    }
  });

  app.patch('/v1/agents/:aid', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);

    const parsed = PatchAgentBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    // If soul/agents/env/llm or persona-relevant fields provided, proxy to agent's PATCH /tenants/:slug
    if (
      parsed.data.soul !== undefined || parsed.data.agents !== undefined ||
      parsed.data.description !== undefined || parsed.data.name !== undefined ||
      parsed.data.env !== undefined || parsed.data.llm !== undefined
    ) {
      const baseUrl = parsed.data.baseUrl ?? a.baseUrl;
      const tenantPatch: Record<string, unknown> = {};
      if (parsed.data.name !== undefined) tenantPatch.name = parsed.data.name;
      if (parsed.data.description !== undefined) tenantPatch.description = parsed.data.description;
      if (parsed.data.soul !== undefined) tenantPatch.soul = parsed.data.soul;
      if (parsed.data.agents !== undefined) tenantPatch.agents = parsed.data.agents;
      if (parsed.data.avatarUrl !== undefined) tenantPatch.avatarUrl = parsed.data.avatarUrl;
      if (parsed.data.tags !== undefined) tenantPatch.tags = parsed.data.tags;
      if (parsed.data.env !== undefined) tenantPatch.env = parsed.data.env;
      if (parsed.data.llm !== undefined) tenantPatch.llm = parsed.data.llm;
      try {
        const tenantRes = await agentFetch(`${baseUrl}/tenants/${a.slug}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(tenantPatch),
        });
        if (!tenantRes.ok && tenantRes.status !== 404) {
          // 404 means the tenant doesn't exist on the agent yet — that's fine
          const body = await tenantRes.text();
          return c.json({ error: 'agent_tenant_patch_failed', status: tenantRes.status, body }, 502);
        }
      } catch (e: any) {
        return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
      }
    }

    // Update marketplace fields
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) $set.name = parsed.data.name;
    if (parsed.data.description !== undefined) $set.description = parsed.data.description;
    if (parsed.data.bio !== undefined) $set.bio = parsed.data.bio;
    if (parsed.data.avatarUrl !== undefined) $set.avatarUrl = parsed.data.avatarUrl;
    if (parsed.data.tags !== undefined) $set.tags = parsed.data.tags;
    if (parsed.data.baseUrl !== undefined) $set.baseUrl = parsed.data.baseUrl;
    if (parsed.data.priceOg !== undefined) $set.priceOg = parsed.data.priceOg;
    const updated = await deps.db.collection(collections.agents).findOneAndUpdate(
      { _id: a._id }, { $set }, { returnDocument: 'after' }
    );
    return c.json({ agent: publicAgent(updated as any) });
  });

  app.delete('/v1/agents/:aid', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    await deleteAgent(deps.db, a._id);
    return c.json({ ok: true });
  });

  app.post('/v1/agents/:aid/rotate-key', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    const key = await rotateAgentKey(deps.db, a._id);
    return c.json({ agentKey: key });
  });

  // ---------------------------------------------------------------------------
  // Public skill search — proxies agentskill.sh so the create-agent flow can
  // browse skills before an agent runtime exists. Unauthenticated; the upstream
  // registry is public.
  // ---------------------------------------------------------------------------

  app.get('/v1/skills/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q) return c.json({ candidates: [] });
    try {
      const url = `https://agentskill.sh/api/skills?q=${encodeURIComponent(q)}&limit=20`;
      const r = await fetch(url);
      if (!r.ok) {
        return c.json({ error: 'upstream_status', status: r.status, candidates: [] }, 502);
      }
      const data: any = await r.json();
      const items: any[] = data.data ?? data.results ?? [];
      const candidates = items.map((it) => ({
        slug: it.owner && it.name ? `${it.owner}/${it.name}` : (it.slug ?? it.name),
        owner: it.owner ?? it.githubOwner ?? '',
        description: it.description ?? '',
        // agentskill.sh exposes contentQualityScore (0-100); use it as the security/quality signal.
        securityScore: typeof it.contentQualityScore === 'number' ? it.contentQualityScore : it.securityScore,
      }));
      return c.json({ candidates });
    } catch (e: any) {
      return c.json({ error: 'upstream_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  // ---------------------------------------------------------------------------
  // Skill management — proxies to the agent runtime's /skills/* API.
  // Owner-only for mutations; reads are public to match the profile-view pattern.
  // ---------------------------------------------------------------------------

  async function proxySkills(baseUrl: string, path: string, init?: RequestInit) {
    const res = await agentFetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, body };
  }

  app.get('/v1/agents/:aid/skills', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    try {
      const r = await proxySkills(a.baseUrl, '/skills');
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  app.get('/v1/agents/:aid/skills/discover', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    const q = c.req.query('q') ?? '';
    try {
      const r = await proxySkills(a.baseUrl, `/skills/discover?q=${encodeURIComponent(q)}`);
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  const InstallSkillBody = z.object({
    source: z.enum(['agentskill.sh', 'clawhub', 'url']).default('agentskill.sh'),
    slug: z.string().min(1).max(128).optional(),
    url: z.string().url().optional(),
  }).refine(d => d.slug || d.url, { message: 'slug or url required' });

  app.post('/v1/agents/:aid/skills/install', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    const parsed = InstallSkillBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
    try {
      const r = await proxySkills(a.baseUrl, '/skills/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  app.delete('/v1/agents/:aid/skills/:name', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    const name = c.req.param('name');
    try {
      const r = await proxySkills(a.baseUrl, `/skills/${encodeURIComponent(name)}`, { method: 'DELETE' });
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  // ---------------------------------------------------------------------------
  // MCP server management — proxies to the agent runtime's /mcp/* API.
  // Owner-only for mutations; GET is unauthenticated (profile-view pattern).
  // ---------------------------------------------------------------------------

  async function proxyMcp(baseUrl: string, path: string, init?: RequestInit) {
    const res = await agentFetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    return { status: res.status, body };
  }

  app.get('/v1/agents/:aid/mcp/servers', async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    try {
      const r = await proxyMcp(a.baseUrl, '/mcp/servers');
      return c.json(maskMcpServers(r.body) as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  const McpServerBody = z.object({
    id: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    enabled: z.boolean().default(true),
  });

  app.post('/v1/agents/:aid/mcp/servers', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    const parsed = McpServerBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
    try {
      const r = await proxyMcp(a.baseUrl, '/mcp/servers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  app.delete('/v1/agents/:aid/mcp/servers/:id', requireAuth, async (c) => {
    const a = await findAgentByIdOrSlug(deps.db, c.req.param('aid'));
    if (!a) return c.json({ error: 'not_found' }, 404);
    if (!canManageAgent(a, c.get('user'))) return c.json({ error: 'forbidden' }, 403);
    const id = c.req.param('id');
    try {
      const r = await proxyMcp(a.baseUrl, `/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return c.json(r.body as any, r.status as any);
    } catch (e: any) {
      return c.json({ error: 'agent_unreachable', message: e?.message ?? String(e) }, 502);
    }
  });

  // ---------------------------------------------------------------------------
  // INFT mint flow — two-step: /mint prepares the on-chain payload, /mint/confirm
  // links the minted token back to an AgentDoc after the frontend calls the contract.
  // ---------------------------------------------------------------------------

  /** Zod schema for POST /v1/agents/mint */
  const MintRequestSchema = z.object({
    slug: z.string().regex(/^[a-z0-9_-]{3,32}$/),
    name: z.string().min(1).max(64),
    description: z.string().min(1).max(500),
    avatarUrl: z.string().url().nullable().optional(),
    tags: z.array(z.string()).default([]),
    soul: z.string().min(1).max(50000),
    agents: z.string().min(1).max(50000),
    llm: z.object({
      provider: z.enum(['openai-compatible', 'zerog', 'zerog-router']).optional(),
      baseUrl: z.string().url().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(1).optional(),
      maxTokens: z.number().min(1).max(32000).optional(),
    }).default({}),
    /**
     * Invite price in OG (decimal string, e.g. "0", "0.5"). Stored on the
     * AgentDoc and used by POST /v1/servers/:sid/invite-agent to charge
     * inviters and route payment to ownerWallet. Defaults to "0" (free).
     */
    priceOg: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  });

  /** Zod schema for POST /v1/agents/mint/confirm */
  const ConfirmRequestSchema = z.object({
    txHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
    reservationId: z.string().uuid(),
  });

  /**
   * POST /v1/agents/mint
   *
   * Encrypts the agent bundle (soul + agents + llm), uploads three blobs to 0G Storage,
   * and returns the data the frontend needs to call BonFireAgentINFT.mint() on-chain.
   * A MintReservationDoc is persisted to guard the slug and allow /confirm to link
   * the resulting tokenId back to an AgentDoc.
   *
   * Auth required — user must have a walletAddress provisioned by Privy.
   */
  app.post('/v1/agents/mint', requireAuth, async (c) => {
    const parsed = MintRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    const { slug, name, description, avatarUrl, tags, soul, agents: agentsText, llm, priceOg } =
      parsed.data;
    const user = c.get('user');

    // 1. Check slug uniqueness across agents collection
    const existingAgent = await deps.db.collection(collections.agents).findOne({ slug });
    if (existingAgent) return c.json({ error: 'agent_slug_taken' }, 409);

    // Check no active (non-expired, non-minted) reservation claims this slug
    const existingReservation = await deps.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .findOne({ slug, status: 'uploaded', expiresAt: { $gt: new Date() } });
    if (existingReservation) return c.json({ error: 'agent_slug_taken' }, 409);

    // 2. Build public manifest (stored in plaintext on 0G Storage)
    const publicManifest = { slug, name, description, avatarUrl: avatarUrl ?? null, tags, version: 1 };

    // 3. Build encrypted bundle
    const bundle = { soul, agents: agentsText, llm };
    const bundleBuffer = Buffer.from(JSON.stringify(bundle), 'utf8');

    // 4. Generate DEK (256-bit data encryption key)
    const dek = nodeRandomBytes(32);

    // 5. Encrypt bundle with AES-256-GCM
    const encryptedEnvelope = encryptAesGcm(bundleBuffer, dek);
    const encryptedBundle = packEnvelope(encryptedEnvelope);

    // 6. Seal DEK with platform-executor public key (ECIES)
    const platformPrivkey = process.env.PLATFORM_EXECUTOR_PRIVATE_KEY;
    if (!platformPrivkey) {
      return c.json({ error: 'server_misconfigured', detail: 'PLATFORM_EXECUTOR_PRIVATE_KEY not set' }, 500);
    }
    const platformExecutorPubkey = pubkeyFromPrivkey(platformPrivkey);
    const sealedDEK = sealEcies(platformExecutorPubkey, dek);

    // 7. Generate reservation ID (returned to frontend for use in /confirm)
    const reservedId = uuidv4();

    // 8. Upload to 0G Storage in parallel
    const storage = createOgStorage();
    // Sequential uploads — parallel collides on the uploader wallet's tx nonce on 0G.
    const manifestUri = await storage.upload(`publicManifest/${reservedId}.json`, Buffer.from(JSON.stringify(publicManifest), 'utf8'));
    const bundleUri = await storage.upload(`encryptedBundle/${reservedId}.bin`, encryptedBundle);
    const sealedDEKUri = await storage.upload(`sealedDEK/${reservedId}/shared.bin`, sealedDEK);

    // Derive the base URI for the sealed DEK directory (strip the filename)
    // Store the sealed-DEK URI as-is; decrypt fetches it directly (no append).
    const sealedDEKBaseUri = sealedDEKUri;

    // 9. Compute bundleHash = keccak256 of the packed encrypted bundle
    const bundleHashHex = keccak256(encryptedBundle);

    // 10. Insert MintReservationDoc — `manifest` caches public fields so /confirm can
    // build the AgentDoc without re-fetching from 0G Storage.
    const now = new Date();
    const reservation: MintReservationDoc & { manifest: typeof publicManifest; priceOg?: string } = {
      _id: new ObjectId(),
      reservedId,
      userId: user._id,
      slug,
      manifestUri,
      bundleUri,
      sealedDEKBaseUri,
      bundleHash: bundleHashHex,
      status: 'uploaded',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // +24h
      manifest: publicManifest,
      priceOg,  // optional; persisted onto the AgentDoc at /confirm
    };

    try {
      await deps.db
        .collection<MintReservationDoc>(collections.mintReservations)
        .insertOne(reservation as unknown as MintReservationDoc);
    } catch (e: any) {
      // Concurrent /mint for the same slug — Mongo's unique index on `slug`
      // catches what the prior findOne checks raced past.
      if (e?.code === 11000) return c.json({ error: 'agent_slug_taken' }, 409);
      throw e;
    }

    const chainMode = 0;

    return c.json({
      mintPayload: {
        manifestUri,
        bundleUri,
        sealedDEKBaseUri,
        bundleHash: bundleHashHex,
        mode: chainMode,
      },
      reservationId: reservedId,
      contractAddress: process.env.INFT_CONTRACT_ADDRESS ?? null,
    });
  });

  /**
   * POST /v1/agents/mint/confirm
   *
   * Called by the frontend after the on-chain mint transaction confirms.
   * Verifies the tx receipt on-chain, checks the bundleHash and owner match
   * the reservation, then inserts the AgentDoc and marks the reservation minted.
   *
   * Auth required — caller must be the address that minted the token.
   */
  app.post('/v1/agents/mint/confirm', requireAuth, async (c) => {
    const parsed = ConfirmRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);

    const { txHash, reservationId } = parsed.data;
    const user = c.get('user');

    // 1. Load reservation
    const reservation = await deps.db
      .collection<MintReservationDoc & { manifest?: Record<string, unknown> }>(collections.mintReservations)
      .findOne({ reservedId: reservationId });

    if (!reservation) return c.json({ error: 'reservation_not_found' }, 410);
    // If already minted, return the existing AgentDoc so repeat calls are idempotent
    // (e.g. React StrictMode double-fire, browser retry after network hiccup).
    if (reservation.status === 'minted') {
      const existing = await deps.db
        .collection<AgentDoc>(collections.agents)
        .findOne({ slug: reservation.slug });
      if (existing) return c.json({ agent: publicAgent(existing) });
      return c.json({ error: 'reservation_already_used' }, 410);
    }
    if (reservation.status !== 'uploaded') return c.json({ error: 'reservation_already_used' }, 410);
    if (reservation.expiresAt < new Date()) return c.json({ error: 'reservation_expired' }, 410);

    // 2. Verify on-chain transaction
    let mintResult: { tokenId: bigint; owner: string; mode: number; bundleHash: string };
    try {
      const inft = createInftChain();
      mintResult = await inft.verifyMintTx(txHash);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'chain_verification_failed', detail: msg }, 400);
    }

    // 3. Assert bundleHash matches (case-insensitive hex comparison)
    if (mintResult.bundleHash.toLowerCase() !== reservation.bundleHash.toLowerCase()) {
      return c.json({ error: 'bundle_hash_mismatch' }, 400);
    }

    // 4. Assert the caller is the minter (anti-front-run check)
    if (!user.walletAddress || mintResult.owner.toLowerCase() !== user.walletAddress.toLowerCase()) {
      return c.json({ error: 'owner_mismatch' }, 403);
    }

    // 5. Build and insert AgentDoc
    const m = reservation.manifest as { name?: string; description?: string; avatarUrl?: string | null; tags?: string[] } | undefined;
    const reservedPrice = (reservation as MintReservationDoc & { priceOg?: string }).priceOg;
    const now = new Date();
    const agentDoc: AgentDoc = {
      _id: new ObjectId(),
      name: m?.name ?? reservation.slug,
      slug: reservation.slug,
      avatarUrl: m?.avatarUrl ?? null,
      description: m?.description ?? '',
      bio: null,
      tags: m?.tags ?? [],
      baseUrl: process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777',
      visibility: 'public',
      agentKeyHash: null,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
      // INFT chain pointers
      tokenId: mintResult.tokenId.toString(),
      contractAddress: process.env.INFT_CONTRACT_ADDRESS ?? undefined,
      ownerWallet: mintResult.owner,
      manifestUri: reservation.manifestUri,
      bundleUri: reservation.bundleUri,
      sealedDEKBaseUri: reservation.sealedDEKBaseUri,
      bundleHash: reservation.bundleHash,
      // Pricing — chosen by the creator at mint time. "0" or absent = free invite.
      priceOg: reservedPrice ?? '0',
    };

    // Idempotent upsert by tokenId — the chain indexer may have inserted this
    // AgentDoc first if /confirm races with the AgentMinted event.
    //
    // priceOg lives off-chain (in the reservation), so the indexer's path
    // can't know it. We `$setOnInsert` chain-derived + immutable fields, but
    // ALWAYS `$set` the price + reservation-only fields so the indexer's
    // null-price placeholder gets overwritten on confirm.
    try {
      // updatedAt and priceOg appear in $set so the indexer's prior insert
      // gets these fields refreshed; everything else is insert-only via
      // $setOnInsert. Mongo errors if the same path appears in both, so we
      // strip them from the immutable shape before the upsert.
      const { priceOg: confirmedPrice, updatedAt: _omitUpdatedAt, ...immutable } = agentDoc;
      void _omitUpdatedAt;
      await deps.db.collection<AgentDoc>(collections.agents).updateOne(
        { tokenId: agentDoc.tokenId },
        {
          $setOnInsert: immutable,
          $set: { priceOg: confirmedPrice, updatedAt: new Date() },
        },
        { upsert: true },
      );
    } catch (e: unknown) {
      const code = (e as Record<string, unknown>)?.code;
      if (code === 11000) return c.json({ error: 'agent_slug_taken' }, 409);
      throw e;
    }

    // 6. Mark reservation as minted
    await deps.db
      .collection<MintReservationDoc>(collections.mintReservations)
      .updateOne({ reservedId: reservationId }, { $set: { status: 'minted' } });

    return c.json({ agent: publicAgent(agentDoc) });
  });

  return app;
}
