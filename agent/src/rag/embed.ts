import { DEFAULT_EMBED_MODEL, pickRequestId, routerBaseUrl, routerFetch } from '../providers/zerog-router.js';
import { currentContext } from '../runtime/request-context.js';

/**
 * 0G Private Computer embeddings (`POST /v1/embeddings`). Every call goes through `routerFetch`, so it
 * is traced like chat: its request ID lands in the turn's ⟦0g:…⟧ marker, it counts toward
 * STUDY_DAILY_CALL_CAP, and it is billed to the student's own key when they connected one (FR9).
 * There is deliberately no fallback provider: if 0G embeddings fail, the caller degrades gracefully.
 */
export type EmbeddingErrorKind = 'no-key' | 'http' | 'network' | 'timeout' | 'bad-response';

export class EmbeddingError extends Error {
  constructor(message: string, readonly kind: EmbeddingErrorKind, readonly status?: number) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export interface EmbedResult {
  vectors: Float32Array[];
  model: string;
  dim: number;
  /** First request ID (the common single-batch case). */
  requestId: string | null;
  /** One per HTTP call, in order. */
  requestIds: (string | null)[];
}

export interface EmbedOptions {
  model?: string;
  /** Max inputs per HTTP call. */
  batchSize?: number;
  /** Max characters per HTTP call; the model's context is 32k tokens, so stay well below. */
  batchChars?: number;
  timeoutMs?: number;
  /** Retry policy for transient failures (tests shorten or stub it). */
  retry?: Partial<RetryPolicy>;
}

/**
 * Transient failures (network errors, HTTP 429 and 5xx) are retried with exponential backoff and jitter,
 * honouring Retry-After. Every attempt goes through routerFetch, so each one is traced and counted
 * toward the daily cap. Other 4xx, timeouts (already 30 s each) and bad responses are not retried.
 */
export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  /** Upper bound on the total time spent waiting between attempts. */
  maxTotalWaitMs: number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}
export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 3, baseMs: 1000, maxTotalWaitMs: 6000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), random: Math.random,
};

export function isRetryable(e: EmbeddingError): boolean {
  return e.kind === 'network' || (e.kind === 'http' && (e.status === 429 || (e.status ?? 0) >= 500));
}

/** Retry-After in ms (delta-seconds or an HTTP date); null when absent or unparseable. Pure. */
export function parseRetryAfter(v: string | null | undefined, now: number = Date.now()): number | null {
  if (!v) return null;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  const at = Date.parse(t);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Wait before retry number `retry` (1-based): base·2^(retry-1) with ±25 % jitter, or Retry-After. Pure. */
export function backoffMs(retry: number, p: Pick<RetryPolicy, 'baseMs' | 'random'>, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return retryAfterMs;
  const exp = p.baseMs * 2 ** (retry - 1);
  return Math.round(exp * (0.75 + 0.5 * p.random()));
}

export function embedModelName(): string {
  return process.env.ZEROG_EMBED_MODEL || DEFAULT_EMBED_MODEL;
}

/** Group inputs into batches by count and size. Pure; exported for tests. */
export function planBatches(texts: string[], batchSize: number, batchChars: number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let chars = 0;
  for (const t of texts) {
    if (cur.length && (cur.length >= batchSize || chars + t.length > batchChars)) { out.push(cur); cur = []; chars = 0; }
    cur.push(t);
    chars += t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function embedTexts(texts: string[], opts: EmbedOptions = {}): Promise<EmbedResult> {
  const model = opts.model ?? embedModelName();
  if (texts.length === 0) return { vectors: [], model, dim: 0, requestId: null, requestIds: [] };
  const key = currentContext()?.zerogApiKey ?? process.env.ZEROG_API_KEY;
  if (!key) throw new EmbeddingError('ZEROG_API_KEY is not set', 'no-key');

  const vectors: Float32Array[] = [];
  const requestIds: (string | null)[] = [];
  const envBase = Number(process.env.ZEROG_EMBED_RETRY_BASE_MS);
  const policy: RetryPolicy = { ...DEFAULT_RETRY, ...(Number.isFinite(envBase) && envBase >= 0 && process.env.ZEROG_EMBED_RETRY_BASE_MS ? { baseMs: envBase } : {}), ...(opts.retry ?? {}) };
  const attempt = async (batch: string[]): Promise<Response> => {
    let res: Response;
    try {
      res = await routerFetch(`${routerBaseUrl()}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: batch }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch (e: any) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      throw new EmbeddingError(timeout ? '0G embeddings timed out' : '0G embeddings unreachable', timeout ? 'timeout' : 'network');
    }
    requestIds.push(pickRequestId(res.headers.get('x-request-id')));
    if (!res.ok) {
      const err = new EmbeddingError(`0G embeddings returned HTTP ${res.status}`, 'http', res.status);
      (err as EmbeddingError & { retryAfterMs?: number | null }).retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      await res.body?.cancel().catch(() => {});
      throw err;
    }
    return res;
  };
  const withRetry = async (batch: string[]): Promise<Response> => {
    let waited = 0;
    for (let n = 1; ; n++) {
      try {
        return await attempt(batch);
      } catch (e) {
        const err = e as EmbeddingError & { retryAfterMs?: number | null };
        if (n >= policy.attempts || !isRetryable(err)) throw err;
        const wait = backoffMs(n, policy, err.retryAfterMs ?? null);
        if (waited + wait > policy.maxTotalWaitMs) throw err; // Retry-After longer than our budget: give up now.
        waited += wait;
        await policy.sleep(wait);
      }
    }
  };
  for (const batch of planBatches(texts, opts.batchSize ?? 32, opts.batchChars ?? 48_000)) {
    const res = await withRetry(batch);
    let body: any;
    try { body = await res.json(); } catch { throw new EmbeddingError('0G embeddings: response is not JSON', 'bad-response'); }
    const data = Array.isArray(body?.data) ? [...body.data] : null;
    if (!data || data.length !== batch.length) throw new EmbeddingError('0G embeddings: wrong number of vectors', 'bad-response');
    data.sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
    for (const d of data) {
      if (!Array.isArray(d?.embedding) || d.embedding.length === 0) throw new EmbeddingError('0G embeddings: missing vector', 'bad-response');
      vectors.push(Float32Array.from(d.embedding));
    }
  }
  const dim = vectors[0].length;
  if (vectors.some((v) => v.length !== dim)) throw new EmbeddingError('0G embeddings: inconsistent dimensions', 'bad-response');
  return { vectors, model, dim, requestId: requestIds[0] ?? null, requestIds };
}
