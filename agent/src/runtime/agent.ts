import { generateText, type CoreMessage, type LanguageModelV1, type Tool } from 'ai';
import { buildSystemPrompt } from './prompt-builder.js';
import { createChatModel } from './llm-client.js';
import { callsTodayFor } from '../providers/zerog-router.js';
import { runWithContext, type RequestContext } from './request-context.js';
import { loadUserKeys } from '../study/zerog-account.js';
import { hashEnv } from './env-hash.js';
import type { LoadedAgent } from '../config/loader.js';
import type { SkillRecord } from '../skills/loader.js';
import type { MemoryStore } from '../memory/store.js';
import { SessionManager, type SessionKey } from './session.js';
import { log } from '../util/logger.js';
import type { InboundMessage, TenantPayload } from '../channels/base.js';
import type { EmbeddingModel } from 'ai';
import { embedText } from '../memory/embeddings.js';
import type { TenantRegistry } from '../tenants/registry.js';
import type { Tenant } from '../tenants/types.js';

/** Marker line carrying 0G request ids; empty string when there are none. The UI strips it and renders a badge. */
export function formatRequestIdMarker(ids: (string | null)[]): string {
  const real = ids.filter((i): i is string => !!i);
  return real.length ? `\n\n⟦0g:${real.join(',')}⟧` : '';
}

/**
 * NFR2: one plain line when no reply could be produced. Network failures and HTTP errors from the
 * model provider say so explicitly, so the student knows it is the inference service, not their notes.
 */
export function failureLine(err: unknown): string {
  if (err == null) return "_(I couldn't form a reply this turn.)_";
  const e = err as { message?: unknown; statusCode?: unknown; cause?: { code?: unknown } };
  const text = `${String(e?.message ?? err)} ${String(e?.cause?.code ?? '')}`;
  const status = typeof e?.statusCode === 'number' ? e.statusCode : undefined;
  if (status === 401 || status === 403) return '_(0G Private Computer rejected the request (API key). Please tell the app owner.)_';
  if (status === 402) return '_(The 0G balance paying for this is empty. Top it up at pc.0g.ai → Deposit, then try again.)_';
  if (status === 429) return '_(0G Private Computer is rate-limiting right now. Please try again in a minute.)_';
  if ((status !== undefined && status >= 400) || /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR|timeout|terminated|network/i.test(text)) {
    return "_(I couldn't reach 0G Private Computer, so I can't answer right now. Please try again in a minute.)_";
  }
  return "_(I couldn't form a reply this turn.)_";
}

/**
 * Text from every step of the tool loop, not just the last. Models often explain first, call a
 * tool, then only add a closing line (e.g. an @-handle); using result.text alone would drop the explanation.
 */
export function joinStepText(result: { text: string; steps?: { text: string }[] }): string {
  const parts = (result.steps ?? []).map((s) => s.text?.trim()).filter(Boolean) as string[];
  return parts.length > 1 ? parts.join('\n\n') : result.text;
}

export interface RuntimeDeps {
  loaded: LoadedAgent;
  model: LanguageModelV1;
  embedModel: EmbeddingModel<string> | null;
  store: MemoryStore;
  getSkills: () => SkillRecord[];
  getTools: () => Record<string, Tool>;
  tenantRegistry?: TenantRegistry;
}

export class AgentRuntime {
  private sessions: SessionManager;
  // Per-tenant model cache; cleared when a tenant is updated via registry subscription.
  private modelCache = new Map<string, LanguageModelV1>();

  constructor(private d: RuntimeDeps) {
    this.sessions = new SessionManager(d.store, d.loaded.config.memory.compactAfterTokens);
    // Subscribe to registry changes to invalidate stale cached models.
    if (d.tenantRegistry) {
      d.tenantRegistry.subscribe((slug) => { this.invalidateTenantCache(slug); });
    }
  }

  /** Return a tenant-specific LanguageModelV1, building and caching it on first use. */
  private async modelFor(tenant: Tenant | TenantPayload | null, envOverride?: Record<string, string>): Promise<LanguageModelV1> {
    // TenantPayload (inline) has no `env` field; Tenant (registry) may have one.
    const tenantEnv = (tenant as Tenant | null)?.env ?? {};
    const override = envOverride ?? {};
    const effectiveEnv = { ...tenantEnv, ...override };
    const tenantLlm = tenant?.llm ?? {};
    const hasOverrides =
      Object.keys(effectiveEnv).length > 0 ||
      Object.keys(tenantLlm).length > 0;
    if (!hasOverrides) return this.d.model;

    const slug = tenant?.slug ?? '_default';
    const cacheKey = `${slug}:${hashEnv(effectiveEnv)}`;
    const cached = this.modelCache.get(cacheKey);
    if (cached) return cached;

    const mergedCfg = {
      ...this.d.loaded.config,
      llm: { ...this.d.loaded.config.llm, ...tenantLlm },
    };
    const resolver = (k: string) => (effectiveEnv[k] !== undefined ? effectiveEnv[k] : process.env[k]);
    try {
      const handle = await createChatModel(mergedCfg, resolver);
      this.modelCache.set(cacheKey, handle.model);
      return handle.model;
    } catch (e: any) {
      log.warn({ tenant: slug, err: e?.message }, 'tenant model build failed; falling back to default');
      // Don't cache the fallback — try again next time (e.g., after config is fixed).
      return this.d.model;
    }
  }

  /** Clear all cache entries for a given tenant slug (covers all env-hash variants). */
  private invalidateTenantCache(slug: string): void {
    for (const key of this.modelCache.keys()) {
      if (key === slug || key.startsWith(`${slug}:`)) {
        this.modelCache.delete(key);
      }
    }
  }

  /** Clear the stored conversation for a session. Returns messages removed. */
  resetSession(key: SessionKey): number {
    return this.sessions.reset(key);
  }

  private inFlight = 0;
  private draining = false;

  /** agent-prd SIGTERM: stop accepting turns, wait (up to timeoutMs) for in-flight turns to finish. */
  async drain(timeoutMs = 15_000): Promise<number> {
    this.draining = true;
    const until = Date.now() + timeoutMs;
    while (this.inFlight > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    return this.inFlight;
  }

  async handle(msg: InboundMessage): Promise<void> {
    if (this.draining) { await msg.reply('_(Restarting — please send that again in a moment.)_'); return; }
    this.inFlight++;
    try { await this.handleTurn(msg); } finally { this.inFlight--; }
  }

  private async handleTurn(msg: InboundMessage): Promise<void> {
    // Prefer inline decrypted bundle; fall back to registry slug lookup only when no inline payload.
    // When tenantInline is provided, skip the registry entirely to avoid "tenant not found" log spam.
    const tenant: Tenant | TenantPayload | null = msg.tenantInline
      ? msg.tenantInline
      : (msg.tenant && this.d.tenantRegistry
          ? this.d.tenantRegistry.get(msg.tenant) ?? null
          : null);

    const soul = tenant?.soul ?? this.d.loaded.soul;
    const agentRules = tenant?.agents ?? this.d.loaded.agents;
    const agentName = tenant?.name ?? this.d.loaded.config.name;
    const tenantPrefix = tenant ? `tenant:${tenant.slug}::` : '';
    const effectiveChatId = `${tenantPrefix}${msg.chatId}`;

    const { sessionId, history } = this.sessions.load({ channel: msg.channel, chatId: effectiveChatId });
    let memorySnippets: string[] = [];
    if (this.d.embedModel) {
      try {
        const v = await embedText(this.d.embedModel, msg.text);
        memorySnippets = this.d.store.searchVectors(v, 5).map(h => h.snippet);
      } catch (e) { log.warn({ err: e }, 'embed/search failed'); }
    }
    const system = buildSystemPrompt({
      agentName,
      soul,
      agents: agentRules,
      skills: this.d.getSkills(),
      memorySnippets,
    });
    const messages: CoreMessage[] = [...history, { role: 'user', content: msg.text }];
    this.sessions.append(sessionId, 'user', msg.text);

    // Build tenant-specific model (cached after first call).
    const model = await this.modelFor(tenant, msg.envOverride);

    const baseArgs = {
      model,
      system,
      messages,
      temperature: this.d.loaded.config.llm.temperature,
      maxTokens: this.d.loaded.config.llm.maxTokens,
    };

    let final: string | null = null;
    let failure: unknown = null;
    let usageTokens = 0;
    const reqCtx: RequestContext = { studentId: msg.studentId, calls: [] };
    // FR9: a student who connected their own 0G account pays for their own calls (and skips the shared cap).
    const ownKeys = msg.studentId ? await loadUserKeys(this.d.loaded.dir, msg.studentId) : null;
    if (ownKeys) reqCtx.zerogApiKey = ownKeys.apiKey;
    const cap = Number(process.env.STUDY_DAILY_CALL_CAP ?? 30);
    if (!ownKeys && msg.studentId && Number.isFinite(cap) && callsTodayFor(msg.studentId) >= cap) {
      const limit = `_(You've reached today's limit of ${cap} AI calls on this demo. Come back tomorrow to keep your streak going.)_`;
      this.sessions.append(sessionId, 'assistant', limit);
      await msg.reply(limit);
      return;
    }
    try {
      const result = await runWithContext(reqCtx, () => generateText({
        ...baseArgs,
        tools: this.d.getTools(),
        maxSteps: 8,
      }));
      final = joinStepText(result) || null;
      usageTokens = result.usage?.totalTokens ?? 0;
    } catch (e: any) {
      failure = e;
      const msg2 = String(e?.message ?? e);
      const looksLikeToolHallucination = /unavailable tool|unknown tool|no such tool|invalid tool/i.test(msg2);
      log.warn({ err: msg2, retryWithoutTools: looksLikeToolHallucination }, 'agent loop: generateText threw');
      if (looksLikeToolHallucination) {
        // Retry with tools disabled. The model hallucinated a function call to something that
        // isn't a tool (e.g., trying to call another agent as a tool). Without tools available,
        // it will reply in plain text, which is what we want for agent-to-agent comms.
        try {
          const retry = await runWithContext(reqCtx, () => generateText({ ...baseArgs, maxSteps: 1 }));
          final = retry.text || null;
          usageTokens = retry.usage?.totalTokens ?? 0;
        } catch (e2: any) {
          failure = e2;
          log.error({ err: e2 }, 'agent loop: retry without tools also failed');
        }
      }
    }

    if (!final) {
      final = failureLine(failure);
    }
    // 0G Private Computer proof: attach request ids (UI strips this marker and renders a badge).
    final += formatRequestIdMarker(reqCtx.calls.map((c) => c.requestId));
    this.sessions.append(sessionId, 'assistant', final);
    await msg.reply(final);

    if (this.d.embedModel) {
      try {
        const v = await embedText(this.d.embedModel, msg.text + '\n' + final);
        this.d.store.indexVector(sessionId, `m:${Date.now()}`, msg.text.slice(0, 500), v);
      } catch (e) { log.warn({ err: e }, 'embed/index failed'); }
    }
    this.sessions.maybeCompact(sessionId, usageTokens);
  }
}
