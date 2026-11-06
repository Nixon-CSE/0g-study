import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { collections } from '../db/types.js';
import type { ChannelDoc, MessageDoc, AgentDoc, ServerMemberDoc, ServerDoc, KnowledgeDocDoc } from '../db/types.js';
import { findAgentByIdOrSlug } from './registry.js';
import { findUserById } from '../users/service.js';
import { invokeAgent, openAgentStream, type TenantPayload } from './client.js';
import { insertMessage } from '../messages/service.js';
import { maybeReplyAttestation } from '../channels/service.js';
import { log } from '../util/logger.js';
import { registerStream } from '../messages/stream-registry.js';
import { resolveMentions } from '../messages/mentions.js';
import type { InftChain } from '../chain/inft.js';
import type { OgStorageClient } from '../storage-0g/index.js';
import { decryptAgentBundle } from './inft-decrypt.js';
import { writeAudit } from '../audit/log.js';
import { retrieveKnowledgeBlock } from './kb-rag.js';
import { uploadIdsIn } from './upload-markers.js';

// ---------------------------------------------------------------------------
// INFT invocation (bundle decrypt)
// ---------------------------------------------------------------------------

/**
 * Dependencies injected by the caller for bundle decryption.
 * All three fields must be present to enable the INFT invocation path.
 */
export interface InftDeps {
  /** On-chain client (e.g. agentOf); not used for invocation gating. */
  inft: InftChain;
  /** 0G Storage client used to fetch encryptedBundle and sealedDEK. */
  storage: OgStorageClient;
  /** Hex private key of the platform-executor wallet (ECIES decryption). */
  platformExecutorPrivkey: string;
}

/**
 * Decrypt the INFT bundle and merge it with the agent's public identity fields to
 * produce a TenantPayload for inline delivery to the ember-agent runtime.
 *
 * Only valid for INFT-backed agents (tokenId present). Throws for legacy agents.
 *
 * @param agent - AgentDoc with chain references
 * @param deps  - INFT deps
 * @returns TenantPayload ready to pass as tenantInline to openAgentStream / invokeAgent
 * @throws Error if the agent has no tokenId
 */
export async function buildInlineTenant(
  agent: AgentDoc,
  deps: InftDeps,
): Promise<TenantPayload> {
  if (!agent.tokenId) {
    // Caller should fall back to slug-based registry lookup in the agent runtime
    throw new Error('not an INFT agent — no inline tenant');
  }
  const bundle = await decryptAgentBundle({
    agent,
    storage: deps.storage,
    platformExecutorPrivkey: deps.platformExecutorPrivkey,
  });
  return { slug: agent.slug, name: agent.name, ...bundle };
}

export function chatIdForChannel(channelId: ObjectId): string {
  return `bonfire:channel:${channelId.toHexString()}`;
}

// ---------------------------------------------------------------------------
// Knowledge-base prepend
// ---------------------------------------------------------------------------
// Server-owned notes from the #knowledge-base channel are fetched once per
// invocation batch and prepended to the text the agent sees. The persisted
// user message is unchanged — only the in-flight `text` carries the block.
//
// With the agent runtime's RAG available (kb-rag.ts), only the chunks relevant to `query` are sent,
// each cited as [kb · <title> · #n], within the same byte budget. If retrieval is disabled or fails,
// this falls back to the old behaviour (newest 20 docs, 8 KB) and logs it.

const KNOWLEDGE_BUDGET_BYTES = 8 * 1024;

export async function buildKnowledgeBlock(db: Db, serverId: ObjectId, query: string): Promise<string | null> {
  const rag = await retrieveKnowledgeBlock(db, serverId, query);
  if (rag.ok) return rag.block;
  if (rag.reason !== 'disabled') log.warn({ serverId: serverId.toHexString(), reason: rag.reason }, 'knowledge RAG unavailable — falling back to newest docs');
  return newestKnowledgeBlock(db, serverId);
}

/** Pre-RAG behaviour: the 20 newest docs, truncated at 8 KB. */
async function newestKnowledgeBlock(db: Db, serverId: ObjectId): Promise<string | null> {
  const docs = await db
    .collection<KnowledgeDocDoc>(collections.knowledgeDocs)
    .find({ serverId })
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray();
  if (docs.length === 0) return null;
  const parts: string[] = [
    '<knowledge_base>',
    `(${docs.length} document${docs.length === 1 ? '' : 's'} from this server — treat as ground truth when relevant.)`,
  ];
  let used = 0;
  for (const d of docs) {
    const entry = `\n## ${d.title}\n${d.content.trim()}`;
    const size = Buffer.byteLength(entry, 'utf8');
    if (used + size > KNOWLEDGE_BUDGET_BYTES) {
      const remaining = KNOWLEDGE_BUDGET_BYTES - used;
      if (remaining > 500) parts.push(entry.slice(0, remaining) + '…');
      break;
    }
    parts.push(entry);
    used += size;
  }
  parts.push('</knowledge_base>');
  return parts.join('\n');
}

export interface InvocationContext {
  db: Db;
  channel: ChannelDoc;
  userMessage: MessageDoc;
  /** Present when decrypting INFT bundles for agent invocation. */
  inftDeps?: InftDeps;
  /** Server wallet for downstream env overrides — not used for authorization. */
  serverWallet?: string;
}

export async function computeInvocationSet(ctx: InvocationContext): Promise<AgentDoc[]> {
  const ids = new Set<string>();
  // Discord convention: when the user @-mentions specific agents, only those reply.
  // The channel's default agent stays quiet on targeted messages.
  const userMentionedAnyAgent = ctx.userMessage.mentions.some(m => m.type === 'agent');
  if (!userMentionedAnyAgent && ctx.channel.defaultAgentId) {
    ids.add(ctx.channel.defaultAgentId.toHexString());
  }
  for (const m of ctx.userMessage.mentions) {
    if (m.type === 'agent') ids.add(m.id.toHexString());
  }
  if (ids.size === 0) return [];

  // Resolve to marketplace agents globally — no server-membership filter, so any registered
  // agent can be summoned from any channel in any server.
  const agents: AgentDoc[] = [];
  for (const id of ids) {
    const a = await findAgentByIdOrSlug(ctx.db, id);
    if (a) agents.push(a);
  }
  return agents;
}

/** Hex id of the human behind a user-authored message (agents have none). */
function studentIdOf(m: MessageDoc): string | undefined {
  return m.authorType === 'user' ? m.authorId.toHexString() : undefined;
}

export interface StreamingHandle { streamId: string; agent: AgentDoc; }

export async function startStreamingInvocation(
  ctx: InvocationContext,
  agents: AgentDoc[],
  envOverride?: Record<string, string>,
): Promise<StreamingHandle[]> {
  const handles: StreamingHandle[] = [];
  const chatId = chatIdForChannel(ctx.channel._id);
  // TEE channels: privacy boundary — skip knowledge-base injection.
  const knowledgeBlock = ctx.channel.tee
    ? null
    : await buildKnowledgeBlock(ctx.db, ctx.channel.serverId, ctx.userMessage.content);
  const textForAgent = knowledgeBlock
    ? `${knowledgeBlock}\n\n${ctx.userMessage.content}`
    : ctx.userMessage.content;
  for (const agent of agents) {
    try {
      // INFT bundle decrypt (streaming path)
      let tenantInline: TenantPayload | undefined;
      if (ctx.inftDeps && agent.tokenId) {
        try {
          tenantInline = await buildInlineTenant(agent, ctx.inftDeps);
        } catch (decryptErr) {
          log.error({ agentSlug: agent.slug, err: decryptErr }, 'bundle decrypt failed — skipping streaming invocation');
          continue;
        }
      }

      const { streamId, upstreamUrl } = await openAgentStream({
        baseUrl: agent.baseUrl,
        chatId,
        text: textForAgent,
        studentId: studentIdOf(ctx.userMessage),
        excludeUploadIds: uploadIdsIn(ctx.userMessage.content),
        tenant: tenantInline ? undefined : agent.slug,
        tenantInline,
        envOverride,
      });
      registerStream({
        streamId,
        channel: ctx.channel,
        agent,
        userMessage: ctx.userMessage,
        upstreamUrl,
        createdAt: Date.now(),
        onClose: async (finalText) => {
          await insertMessage(ctx.db, {
            channelId: ctx.channel._id,
            serverId: ctx.channel.serverId,
            authorType: 'agent',
            authorId: agent._id,
            content: finalText,
            mentions: [],
            teeHash: maybeReplyAttestation(ctx.channel),
          });
        },
      });
      handles.push({ streamId, agent });
    } catch (e) {
      log.warn({ agent: agent.slug, err: e }, 'open stream failed');
    }
  }
  return handles;
}

export async function runInvocation(ctx: InvocationContext, agents: AgentDoc[]): Promise<MessageDoc[]> {
  const out: MessageDoc[] = [];
  const chatId = chatIdForChannel(ctx.channel._id);
  // TEE channels: privacy boundary — skip knowledge-base injection.
  const knowledgeBlock = ctx.channel.tee
    ? null
    : await buildKnowledgeBlock(ctx.db, ctx.channel.serverId, ctx.userMessage.content);
  const textForAgent = knowledgeBlock
    ? `${knowledgeBlock}\n\n${ctx.userMessage.content}`
    : ctx.userMessage.content;
  for (const agent of agents) {
    try {
      const replyText = await invokeAgent({
        baseUrl: agent.baseUrl,
        chatId,
        text: textForAgent,
        studentId: studentIdOf(ctx.userMessage),
        excludeUploadIds: uploadIdsIn(ctx.userMessage.content),
        tenant: agent.slug,
      });
      const persisted = await insertMessage(ctx.db, {
        channelId: ctx.channel._id,
        serverId: ctx.channel.serverId,
        authorType: 'agent',
        authorId: agent._id,
        content: replyText,
        mentions: [],
        teeHash: maybeReplyAttestation(ctx.channel),
      });
      out.push(persisted);
    } catch (e) {
      log.warn({ agent: agent.slug, err: e }, 'agent invocation failed');
      const failureMsg = await insertMessage(ctx.db, {
        channelId: ctx.channel._id,
        serverId: ctx.channel.serverId,
        authorType: 'agent',
        authorId: agent._id,
        content: '_(agent unreachable)_',
        mentions: [],
      });
      out.push(failureMsg);
    }
  }
  return out;
}

export interface CascadeConfig {
  maxHops: number;
  maxInvocationsPerRoot: number;
}

export const DEFAULT_CASCADE: CascadeConfig = { maxHops: 5, maxInvocationsPerRoot: 20 };

export interface CascadeContext {
  db: Db;
  channel: ChannelDoc;
  rootMessage: MessageDoc;
  config?: Partial<CascadeConfig>;
  /** Server doc for the channel's server — used to derive the 0G wallet envOverride for inference. */
  server?: ServerDoc;
  /** Present when INFT authorization gate + bundle decryption should be applied. */
  inftDeps?: InftDeps;
}

/**
 * Builds the envOverride map for a server's 0G wallet private key.
 *
 * Returns undefined when no wallet is present so the caller can omit the field entirely,
 * rather than sending an empty object that the agent would still try to interpret.
 */
function envOverrideFromServer(server?: ServerDoc): Record<string, string> | undefined {
  if (!server?.wallet?.privateKey) return undefined;
  return { DEPLOYER_PRIVATE_KEY: server.wallet.privateKey };
}

interface QueuedInvocation {
  parentMessage: MessageDoc;
  agent: AgentDoc;
  hop: number;
}

export async function runCascade(ctx: CascadeContext): Promise<MessageDoc[]> {
  const config: CascadeConfig = { ...DEFAULT_CASCADE, ...(ctx.config ?? {}) };
  // Derive once so all hops within this cascade use the same server wallet.
  const envOverride = envOverrideFromServer(ctx.server);
  const serverWallet = ctx.server?.wallet?.address;

  // cascadeEnabled === false → direct-only fallback (no follow-up of agent mentions)
  if (ctx.channel.cascadeEnabled === false) {
    const direct = await computeInvocationSet({
      db: ctx.db, channel: ctx.channel, userMessage: ctx.rootMessage,
    });
    return runInvocationLinked({
      db: ctx.db, channel: ctx.channel, parent: ctx.rootMessage, agents: direct,
      hop: 1, rootId: ctx.rootMessage._id, studentId: studentIdOf(ctx.rootMessage), envOverride,
      excludeUploadIds: uploadIdsIn(ctx.rootMessage.content),
      inftDeps: ctx.inftDeps, serverWallet,
    });
  }

  const out: MessageDoc[] = [];
  const visited = new Set<string>();
  let totalInvocations = 0;

  const initialAgents = await computeInvocationSet({
    db: ctx.db, channel: ctx.channel, userMessage: ctx.rootMessage,
  });

  const queue: QueuedInvocation[] = initialAgents.map(agent => ({
    parentMessage: ctx.rootMessage,
    agent,
    hop: 1,
  }));

  while (queue.length > 0) {
    if (totalInvocations >= config.maxInvocationsPerRoot) break;
    const next = queue.shift()!;
    const agentIdHex = next.agent._id.toHexString();
    if (visited.has(agentIdHex)) continue;
    if (next.hop > config.maxHops) continue;
    visited.add(agentIdHex);

    const replies = await runInvocationLinked({
      db: ctx.db, channel: ctx.channel, parent: next.parentMessage, agents: [next.agent],
      hop: next.hop, rootId: ctx.rootMessage._id, studentId: studentIdOf(ctx.rootMessage), envOverride,
      excludeUploadIds: uploadIdsIn(ctx.rootMessage.content),
      inftDeps: ctx.inftDeps, serverWallet,
    });
    totalInvocations++;
    out.push(...replies);

    // Follow @mentions in the just-persisted reply, unless this hop is the last allowed.
    if (next.hop >= config.maxHops) continue;
    for (const reply of replies) {
      const newMentions = await resolveMentions(ctx.db, ctx.channel.serverId, reply.content);
      const followups = await mentionsToAgents(ctx.db, ctx.channel, newMentions, visited);
      for (const a of followups) {
        queue.push({ parentMessage: reply, agent: a, hop: next.hop + 1 });
      }
    }
  }

  return out;
}

export function channelContextLine(args: {
  channel: ChannelDoc;
  target: AgentDoc;
  peerSlugs: string[];
  speakerLabel: string;
}): string {
  const peers = args.peerSlugs.filter(s => s !== args.target.slug).map(s => '@' + s).join(', ');
  const base = `[${args.speakerLabel} → @${args.target.slug} in #${args.channel.name}`;
  return peers ? `${base} | peers: ${peers}]` : `${base}]`;
}

export interface PrepareInvocationInput {
  parent: MessageDoc;
  target: AgentDoc;
  channel: ChannelDoc;
  peerSlugs: string[];
  speakerLabel: string;
  /** True when the most recent message in the chain came from a human user (not another agent). */
  speakerIsHuman: boolean;
}

/**
 * Fixed hand-offs for agent pipelines (Study Pod, PRD FR5): reader -> tutor -> examiner.
 * The generic cascade protocol below tells agents NOT to @-mention peers on their own; for a
 * pipeline stage that would break the chain, so these stages are told to hand off instead.
 * The examiner has no entry: it never mentions anyone, which ends the cascade.
 */
export const PIPELINE_HANDOFFS: Readonly<Record<string, string>> = {
  'study-note-reader': 'study-tutor',
  'study-tutor': 'study-examiner',
};

/** Every agent of a fixed pipeline (its stages and its last stage). */
export function isPipelineStage(slug: string): boolean {
  return slug in PIPELINE_HANDOFFS || Object.values(PIPELINE_HANDOFFS).includes(slug);
}

/** Next pipeline stage for `slug`, only when that stage is actually present in the channel. */
export function pipelineNext(slug: string, peerSlugs: string[]): string | null {
  const next = PIPELINE_HANDOFFS[slug];
  return next && peerSlugs.includes(next) ? next : null;
}

export function prepareInvocationText(input: PrepareInvocationInput): string {
  const line = channelContextLine(input);
  const peers = input.peerSlugs.filter(s => s !== input.target.slug).map(s => '@' + s);
  const handoff = pipelineNext(input.target.slug, input.peerSlugs);
  const handoffRule = handoff
    ? `\n[PIPELINE HAND-OFF — overrides any rule above about not mentioning peers]
You are a stage in a fixed pipeline. After your full answer, end your reply with a final line containing only "@${handoff}" and nothing else.
[END HAND-OFF]\n`
    : '';
  const studentFacing = isPipelineStage(input.target.slug)
    ? `\n[STUDENT-FACING] Your reply is read by the student. Talk to them about the material only: never mention this message, the pipeline, other agents, hand-offs, tools, searches, or anything that was or wasn't received.\n`
    : '';

  // Only include the FORWARDING RULE when a human is asking. For agent-to-agent turns we
  // include an explicit DO-NOT-FORWARD note (because prior human turns' protocol may be cached
  // in the agent's memory and the model would otherwise keep auto-forwarding).
  let protocol = '';
  if (peers.length > 0 && input.speakerIsHuman) {
    protocol = `\n[CHANNEL PROTOCOL — read first]
You are @${input.target.slug} in channel #${input.channel.name}, replying to ${input.speakerLabel} (a human). Other agents available in this channel: ${peers.join(', ')}.

PEERS ARE NOT TOOLS: Peer agents are summoned by writing their @-handle in your plain-text reply. They are NOT function/tool calls — never attempt to call them as a tool or function (e.g., do not emit a tool call to "joke_bot" or "critic"). The only way to involve a peer is to mention them by @-handle in your text.

FORWARDING RULE: If the human's message asks you to tell, ask, call, share with, forward to, or otherwise involve one of the listed peers (named with or without the "@", e.g. "tell critic" or "@critic"), you MUST:
  1. If the human asks you to FETCH something from a peer (e.g., "get a joke from joke-bot", "ask researcher for sources"), DO NOT invent it yourself — instead, @-mention that peer in your reply asking them for the content. Do not fabricate output you were supposed to ask for.
  2. Otherwise, first give your full, substantive answer to the human's request — never reply with only an @-mention.
  3. Then, on a NEW LINE at the END of your reply, write the peer's literal @-handle (e.g., "@critic") and nothing else on that line.
This applies even if your personality says "say nothing else" — invitations are an exception, but your answer must still come first. Only invite peers the human actually named. Do not invite peers unless explicitly asked.
[END PROTOCOL]\n`;
  } else if (peers.length > 0) {
    // Agent-to-agent turn: explicitly suppress forwarding behavior + forbid echoing.
    protocol = `\n[AGENT-TO-AGENT — read first]
You are @${input.target.slug}. ${input.speakerLabel} (another agent, not a human) just spoke to you. Respond AS YOURSELF, in YOUR OWN voice and personality.

CRITICAL RULES:
1. DO NOT echo, paraphrase, or repeat ${input.speakerLabel}'s message back. You are not a relay.
2. Read ${input.speakerLabel}'s message, understand what they're asking YOU to do, then produce the output that fits YOUR personality.
3. If ${input.speakerLabel} asked you to do something specific (plan something, critique something, joke about something), DO that thing in your reply — don't restate their request.
4. DO NOT end your reply with any "@<peer>" handle — the cascade stops here unless you genuinely need to ask another agent a question you can't answer.
5. Even if an earlier "FORWARDING RULE" lives in your memory of this channel, it does NOT apply right now.
[END]\n`;
  }
  return `${line}${protocol}${handoffRule}${studentFacing}\n${input.parent.content}`;
}

/**
 * Returns true when `reply` is substantially identical to `parent.content` —
 * i.e. the cascade child echoed its input back instead of producing a real
 * response. Used as a safety net against weak models that just relay text.
 */
function isEchoOfParent(reply: string, parentContent: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const r = normalize(reply);
  const p = normalize(parentContent);
  if (r.length === 0 || p.length === 0) return false;
  // Exact match after normalization, OR reply is 90%+ contained in parent.
  if (r === p) return true;
  // Cheap Jaccard-like overlap on word tokens.
  const tok = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const a = tok(reply), b = tok(parentContent);
  if (a.size === 0) return false;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return (common / a.size) >= 0.85;
}

async function peerSlugsForChannel(db: Db, channel: ChannelDoc): Promise<string[]> {
  const members = await db.collection<ServerMemberDoc>(collections.serverMembers)
    .find({ serverId: channel.serverId, principalType: 'agent' }).toArray();
  const ids = members.map(m => m.principalId);
  if (ids.length === 0) return [];
  const agents = await db.collection<AgentDoc>(collections.agents)
    .find({ _id: { $in: ids } }, { projection: { slug: 1 } }).toArray();
  return agents.map(a => a.slug);
}

async function speakerLabelFor(db: Db, parent: MessageDoc): Promise<string> {
  if (parent.authorType === 'agent') {
    const a = await findAgentByIdOrSlug(db, parent.authorId.toHexString());
    return a ? '@' + a.slug : '@agent';
  }
  const u = await findUserById(db, parent.authorId);
  return u ? '@' + u.username : '@user';
}

async function runInvocationLinked(args: {
  db: Db;
  channel: ChannelDoc;
  parent: MessageDoc;
  agents: AgentDoc[];
  hop: number;
  rootId: ObjectId;
  /** Human who started the cascade (study state is per user). */
  studentId?: string;
  /** `[[upload:…]]` ids in the cascade root (the human's message): every hop's recall skips them. */
  excludeUploadIds?: string[];
  /** Per-request env overrides forwarded to the agent (e.g. DEPLOYER_PRIVATE_KEY for 0G inference). */
  envOverride?: Record<string, string>;
  /** INFT bundle decryption deps when invoking token-backed agents. */
  inftDeps?: InftDeps;
  /** Server wallet for env overrides — not used for authorization. */
  serverWallet?: string;
}): Promise<MessageDoc[]> {
  const out: MessageDoc[] = [];
  const chatId = chatIdForChannel(args.channel._id);
  const peerSlugs = await peerSlugsForChannel(args.db, args.channel);
  const speakerLabel = await speakerLabelFor(args.db, args.parent);
  const speakerIsHuman = args.parent.authorType === 'user';
  // TEE channels: privacy boundary — skip knowledge-base injection on every hop.
  const knowledgeBlock = args.channel.tee
    ? null
    : await buildKnowledgeBlock(args.db, args.channel.serverId, args.parent.content);
  for (const agent of args.agents) {
    const startMs = Date.now();
    try {
      // INFT bundle decryption (only when inftDeps injected)
      let tenantInline: TenantPayload | undefined;
      if (args.inftDeps && agent.tokenId) {
        try {
          tenantInline = await buildInlineTenant(agent, args.inftDeps);
        } catch (decryptErr) {
          log.error({ agentSlug: agent.slug, err: decryptErr }, 'bundle decrypt failed — skipping invocation');
          continue;
        }
      }

      await writeAudit(args.db, {
        serverId: args.channel.serverId,
        channelId: args.channel._id,
        actorType: args.parent.authorType === 'user' ? 'user' : 'agent',
        actorId: args.parent.authorId,
        agentId: agent._id,
        agentSlug: agent.slug,
        action: 'agent_invoked',
        payload: {
          parentMessageId: args.parent._id.toHexString(),
          cascadeHop: args.hop,
          inputPreview: args.parent.content.slice(0, 200),
        },
      });

      const baseText = prepareInvocationText({
        parent: args.parent,
        target: agent,
        channel: args.channel,
        peerSlugs,
        speakerLabel,
        speakerIsHuman,
      });
      const text = knowledgeBlock ? `${knowledgeBlock}\n\n${baseText}` : baseText;
      let replyText = await invokeAgent({
        baseUrl: agent.baseUrl,
        chatId,
        text,
        studentId: args.studentId,
        excludeUploadIds: args.excludeUploadIds,
        tenant: tenantInline ? undefined : agent.slug,
        tenantInline,
        envOverride: args.envOverride,
      });
      // Echo guard — only on agent-to-agent hops. Weak models sometimes just relay the
      // parent message verbatim. Retry once with a strongly worded re-prompt; if it still
      // echoes, fall through with a placeholder so the user sees *something* happened.
      if (args.parent.authorType === 'agent' && isEchoOfParent(replyText, args.parent.content)) {
        log.warn(
          { agent: agent.slug, parent: args.parent._id.toHexString() },
          'cascade child echoed parent — retrying with stronger prompt',
        );
        const retryText = `[RETRY — you just echoed @${speakerLabel.replace(/^@/, '')}'s message back instead of responding. THAT WAS WRONG.]

You are @${agent.slug}. Respond AS YOURSELF in YOUR OWN words and personality. Do NOT repeat their message back. Do NOT use the same phrasing. Read what they said, then produce YOUR distinct response in YOUR voice.

What ${speakerLabel} said to you: "${args.parent.content}"

Your response (as @${agent.slug}):`;
        replyText = await invokeAgent({
          baseUrl: agent.baseUrl,
          chatId,
          text: retryText,
          studentId: args.studentId,
          excludeUploadIds: args.excludeUploadIds,
          tenant: tenantInline ? undefined : agent.slug,
          tenantInline,
          envOverride: args.envOverride,
        });
        // If still an echo, drop and don't spam — but log so we know it happened.
        if (isEchoOfParent(replyText, args.parent.content)) {
          log.warn(
            { agent: agent.slug, parent: args.parent._id.toHexString() },
            'cascade child still echoed after retry — dropping',
          );
          continue;
        }
      }
      const persisted = await insertMessage(args.db, {
        channelId: args.channel._id,
        serverId: args.channel.serverId,
        authorType: 'agent',
        authorId: agent._id,
        content: replyText,
        mentions: [],
        teeHash: maybeReplyAttestation(args.channel),
      });
      // Backfill cascade metadata. insertMessage doesn't accept these fields yet.
      await args.db.collection(collections.messages).updateOne(
        { _id: persisted._id },
        { $set: { parentMessageId: args.parent._id, cascadeRootId: args.rootId, cascadeHop: args.hop } }
      );
      const updated = await args.db.collection<MessageDoc>(collections.messages).findOne({ _id: persisted._id });
      if (updated) {
        await writeAudit(args.db, {
          serverId: args.channel.serverId,
          channelId: args.channel._id,
          actorType: 'agent',
          actorId: agent._id,
          agentId: agent._id,
          agentSlug: agent.slug,
          action: 'agent_replied',
          payload: {
            parentMessageId: args.parent._id.toHexString(),
            cascadeHop: args.hop,
            replyMessageId: updated._id.toHexString(),
            replyPreview: replyText.slice(0, 200),
            durationMs: Date.now() - startMs,
          },
        });
        out.push(updated);
      }
    } catch (e) {
      await writeAudit(args.db, {
        serverId: args.channel.serverId,
        channelId: args.channel._id,
        actorType: 'system',
        actorId: null,
        agentId: agent._id,
        agentSlug: agent.slug,
        action: 'agent_failed',
        payload: { error: (e as Error).message?.slice(0, 300) },
      });
      log.warn({ agent: agent.slug, err: e }, 'agent invocation failed');
      const failureMsg = await insertMessage(args.db, {
        channelId: args.channel._id,
        serverId: args.channel.serverId,
        authorType: 'agent',
        authorId: agent._id,
        content: '_(agent unreachable)_',
        mentions: [],
      });
      await args.db.collection(collections.messages).updateOne(
        { _id: failureMsg._id },
        { $set: { parentMessageId: args.parent._id, cascadeRootId: args.rootId, cascadeHop: args.hop } }
      );
      const updated = await args.db.collection<MessageDoc>(collections.messages).findOne({ _id: failureMsg._id });
      if (updated) out.push(updated);
    }
  }
  return out;
}

async function mentionsToAgents(
  db: Db,
  _channel: ChannelDoc,
  mentions: { type: 'user' | 'agent'; id: ObjectId }[],
  visited: Set<string>,
): Promise<AgentDoc[]> {
  // No server-membership filter — agents are global. Cascades follow @-mentions to any
  // marketplace agent regardless of which server originated the chain.
  const ids = mentions
    .filter(m => m.type === 'agent')
    .map(m => m.id.toHexString())
    .filter(id => !visited.has(id));
  if (ids.length === 0) return [];
  const out: AgentDoc[] = [];
  for (const id of ids) {
    const a = await findAgentByIdOrSlug(db, id);
    if (a) out.push(a);
  }
  return out;
}
