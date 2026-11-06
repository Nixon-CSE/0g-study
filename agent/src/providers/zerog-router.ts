import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV1 } from 'ai';
import { log } from '../util/logger.js';
import { currentContext } from '../runtime/request-context.js';

/**
 * 0G Private Computer (Router API) — TEE-verified, OpenAI-compatible.
 *   base URL: https://router-api.0g.ai/v1
 *   key:      https://pc.0g.ai/dashboard/api-keys  ->  ZEROG_API_KEY
 *
 * Every call (chat, image, embeddings) is traced: request id (response header), status, token usage.
 * Request ids are drained by the agent loop and attached to the reply so the UI can show proof.
 */
export const ZEROG_ROUTER_URL = 'https://router-api.0g.ai/v1';
// Verified 2026-11-06 with scripts/smoke-router.mjs + a tool-call probe: chat, tools and
// chat_template_kwargs all accepted. (The earlier default, 0gm-1.0-35b-a3b, now returns 404 model_not_found.)
export const DEFAULT_ROUTER_MODEL = 'deepseek-v4.1-flash';
// Vision: transcribed a printed notes photo faithfully (data URL in image_url). No tool calls — not needed.
export const DEFAULT_VISION_MODEL = 'qwen2.5-vl-72b-instruct';
export const DEFAULT_IMAGE_MODEL = 'z-image';
// Embeddings (study memory / RAG): verified 2026-11-06 with scripts/smoke-embeddings.mjs: 1024-dim,
// batching works, 32k-token context, x-request-id like chat. qwen3-embedding-8b (4096-dim) also works.
export const DEFAULT_EMBED_MODEL = 'qwen3-embedding-0.6b';

export interface RouterCall {
  requestId: string | null;
  kind: 'chat' | 'image' | 'embedding' | 'other';
  status: number;
  studentId?: string;
  tokens: number;
  at: string;
  /**
   * The router's `x-0g-e2ee` response header, verbatim (e.g. "sealed" for a TEE provider, "none"
   * otherwise); null when absent. Shown next to the request id on the 0G badge; never inferred.
   */
  e2ee?: string | null;
}

/** A short lowercase token, or null (anything else is dropped rather than echoed). */
export function e2eeValue(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return /^[a-z]{1,16}$/.test(v) ? v : null;
}

const pending: RouterCall[] = [];
const today: RouterCall[] = [];

export function drainRouterCalls(): RouterCall[] {
  return pending.splice(0, pending.length);
}

/**
 * Today's 0G usage. With `studentId`, only that student's calls (what GET /usage shows a signed-in
 * student); without it, the whole process (open dev mode, tests). The trace records each call's student.
 */
export function usageToday(studentId?: string) {
  const day = new Date().toISOString().slice(0, 10);
  const calls = today.filter((c) => c.at.startsWith(day) && (studentId === undefined || c.studentId === studentId));
  return {
    day,
    calls: calls.length,
    tokens: calls.reduce((n, c) => n + c.tokens, 0),
    images: calls.filter((c) => c.kind === 'image').length,
    lastRequestIds: calls.filter((c) => c.requestId).slice(-5).map((c) => c.requestId),
  };
}

const REQUEST_ID_HEADERS = ['x-request-id', 'x-0g-request-id', 'request-id'];

/**
 * The router sends TWO X-Request-Id headers (a 16-hex gateway id and a UUID), which fetch joins
 * with ", ". Keep one id: prefer the UUID. Checked 2026-11-06: the response body's own
 * `x_0g_trace.request_id` (next to the billing record) is that UUID, for chat and embeddings, so the
 * UUID is 0G's request id. makeTracedFetch prefers the body value when present.
 */
export function pickRequestId(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.find((p) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) ?? parts[0] ?? null;
}

/**
 * Open-weight families served through a chat template accept `chat_template_kwargs`.
 * Hosted OpenAI-style models reject the unknown field (gpt-5.4-mini -> HTTP 400), so only these get it.
 */
const THINKING_KWARGS_MODELS = /^(qwen|deepseek|glm|kimi|mimo|0gm)/i;
export function acceptsThinkingKwargs(model: unknown): boolean {
  return typeof model === 'string' && THINKING_KWARGS_MODELS.test(model);
}

/** Router models think by default, which burns max_tokens. Turn thinking off unless ZEROG_THINKING=on. */
export function withThinkingOff(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (process.env.ZEROG_THINKING !== 'on' && url.includes('/chat/completions') && typeof init?.body === 'string') {
      try {
        const b = JSON.parse(init.body);
        if (b && typeof b === 'object' && !b.chat_template_kwargs && acceptsThinkingKwargs(b.model)) {
          b.chat_template_kwargs = { enable_thinking: false };
          return base(input, { ...init, body: JSON.stringify(b) });
        }
      } catch { /* not JSON: send as is */ }
    }
    return base(input, init);
  };
}

/** Wrap a fetch so every router call is traced (request id, status, tokens). */
export function makeTracedFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let requestId: string | null = null;
    for (const h of REQUEST_ID_HEADERS) { requestId = pickRequestId(res.headers.get(h)); if (requestId) break; }
    let tokens = 0;
    try {
      if ((res.headers.get('content-type') ?? '').includes('json')) {
        const j: any = await res.clone().json();
        tokens = Number(j?.usage?.total_tokens ?? 0) || 0;
        // 0G's own trace record names the request id; prefer it over the headers.
        const traced = j?.x_0g_trace?.request_id;
        if (typeof traced === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(traced)) requestId = traced;
        // Fallback (PRD G2): no header -> use the completion id from the JSON body.
        if (!requestId && typeof j?.id === 'string') requestId = j.id;
      }
    } catch { /* usage / id are best-effort */ }
    const ctx = currentContext();
    const call: RouterCall = {
      requestId,
      kind: url.includes('/images/') ? 'image' : url.includes('/chat/') ? 'chat' : url.includes('/embeddings') ? 'embedding' : 'other',
      status: res.status,
      tokens,
      studentId: ctx?.studentId,
      at: new Date().toISOString(),
      e2ee: e2eeValue(res.headers.get('x-0g-e2ee')),
    };
    ctx?.calls.push(call);
    pending.push(call);
    today.push(call);
    if (pending.length > 200) pending.shift();
    if (today.length > 5000) today.shift();
    log.info({ requestId, kind: call.kind, status: res.status, tokens }, '0G Private Computer call');
    return res;
  };
}

/**
 * FR9: when the current turn carries the student's own key, use it for router calls instead of
 * the shared key the client was built with. Only router URLs are touched.
 */
export function withUserKey(base: typeof fetch): typeof fetch {
  return async (input, init) => {
    const key = currentContext()?.zerogApiKey;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (key && url.startsWith(routerBaseUrl())) {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${key}`);
      return base(input, { ...init, headers });
    }
    return base(input, init);
  };
}

export const routerFetch: typeof fetch = makeTracedFetch(withThinkingOff(withUserKey((i, n) => fetch(i, n))));

/** Router calls made by one student today (for the daily cap, NFR3). */
export function callsTodayFor(studentId: string, now: Date = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  return today.filter((c) => c.studentId === studentId && c.at.startsWith(day)).length;
}

/** Test helper. */
export function resetRouterTrace() { pending.length = 0; today.length = 0; }

export function routerBaseUrl(override?: string) {
  return override ?? process.env.ZEROG_BASE_URL ?? ZEROG_ROUTER_URL;
}

export function createZeroGRouterModel(opts: { modelId?: string; apiKey?: string; baseUrl?: string }) {
  const modelId = opts.modelId ?? process.env.ZEROG_LLM_MODEL ?? DEFAULT_ROUTER_MODEL;
  if (!opts.apiKey) throw new Error('0G Private Computer: set ZEROG_API_KEY (pc.0g.ai/dashboard/api-keys)');
  const provider = createOpenAICompatible({
    name: '0g-private-computer',
    baseURL: routerBaseUrl(opts.baseUrl),
    apiKey: opts.apiKey,
    fetch: routerFetch,
  });
  return { model: provider.chatModel(modelId) as LanguageModelV1, modelId };
}
