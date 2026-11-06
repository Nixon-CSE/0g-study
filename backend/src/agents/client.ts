import { agentFetch } from './admin-token.js';

/**
 * Inline tenant payload — carries the decrypted INFT bundle directly to the agent
 * runtime so it can skip the slug-based registry lookup.
 */
export interface TenantPayload {
  slug: string;
  name: string;
  soul: string;
  agents: string;
  llm: {
    provider?: 'openai-compatible' | 'zerog' | 'zerog-router';
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    apiKeyEnv?: string;
  };
}

export interface InvokeAgentInput {
  baseUrl: string;
  chatId: string;
  text: string;
  /** Tenant slug — routes to a named personality on the agent (legacy path). */
  tenant?: string;
  /**
   * Inline tenant payload (INFT path).
   * When provided, takes precedence over `tenant`; the agent runtime uses it
   * directly and skips registry lookup.
   */
  tenantInline?: TenantPayload;
  /** Per-request env overrides forwarded to the agent runtime (e.g. DEPLOYER_PRIVATE_KEY for 0G inference). */
  envOverride?: Record<string, string>;
  /** Human who started this turn; lets the agent keep per-user study state. */
  studentId?: string;
  /** Uploads in the cascade's root message; the agent's recall_notes skips them (they are today's notes). */
  excludeUploadIds?: string[];
  /** Abort signal for upstream call. */
  signal?: AbortSignal;
}

export async function invokeAgent(input: InvokeAgentInput): Promise<string> {
  const body: Record<string, unknown> = { userId: input.chatId, text: input.text };
  if (input.studentId) body.studentId = input.studentId;
  if (input.excludeUploadIds?.length) body.excludeUploadIds = input.excludeUploadIds;
  if (input.tenantInline) {
    // Inline tenant takes precedence — agent runtime detects object vs string
    body.tenant = input.tenantInline;
  } else if (input.tenant) {
    body.tenant = input.tenant;
  }
  if (input.envOverride && Object.keys(input.envOverride).length > 0) {
    body.envOverride = input.envOverride;
  }
  const msgRes = await agentFetch(`${input.baseUrl}/chat/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!msgRes.ok) throw new Error(`agent /chat/message returned ${msgRes.status}`);
  const { streamId } = (await msgRes.json()) as { streamId: string };
  if (!streamId) throw new Error('agent did not return streamId');

  const streamRes = await fetch(`${input.baseUrl}/chat/stream/${streamId}`, { signal: input.signal });
  if (!streamRes.ok || !streamRes.body) throw new Error(`agent stream returned ${streamRes.status}`);

  return await accumulateSse(streamRes.body);
}

export async function* sseChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = event.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === '{}') continue;
      try {
        const parsed = JSON.parse(payload);
        if (typeof parsed.chunk === 'string') yield parsed.chunk;
      } catch { /* ignore malformed events */ }
    }
  }
}

async function accumulateSse(body: ReadableStream<Uint8Array>): Promise<string> {
  let out = '';
  for await (const chunk of sseChunks(body)) out += chunk;
  return out;
}

export interface OpenStreamHandle { streamId: string; upstreamUrl: string; }

/** Phase 1: POST /chat/message and return the agent-issued streamId without consuming the stream yet. */
export async function openAgentStream(input: {
  baseUrl: string;
  chatId: string;
  text: string;
  /** Tenant slug (legacy path). */
  tenant?: string;
  /**
   * Inline tenant payload (INFT path).
   * When provided, takes precedence over `tenant`.
   */
  tenantInline?: TenantPayload;
  /** Per-request env overrides forwarded to the agent runtime (e.g. DEPLOYER_PRIVATE_KEY for 0G inference). */
  envOverride?: Record<string, string>;
  /** Human who started this turn. */
  studentId?: string;
  /** Uploads in the root message (see InvokeAgentInput). */
  excludeUploadIds?: string[];
}): Promise<OpenStreamHandle> {
  const body: Record<string, unknown> = { userId: input.chatId, text: input.text };
  if (input.studentId) body.studentId = input.studentId;
  if (input.excludeUploadIds?.length) body.excludeUploadIds = input.excludeUploadIds;
  if (input.tenantInline) {
    body.tenant = input.tenantInline;
  } else if (input.tenant) {
    body.tenant = input.tenant;
  }
  if (input.envOverride && Object.keys(input.envOverride).length > 0) {
    body.envOverride = input.envOverride;
  }
  const res = await agentFetch(`${input.baseUrl}/chat/message`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`agent /chat/message returned ${res.status}`);
  const { streamId } = (await res.json()) as { streamId: string };
  if (!streamId) throw new Error('agent did not return streamId');
  return { streamId, upstreamUrl: `${input.baseUrl}/chat/stream/${streamId}` };
}
