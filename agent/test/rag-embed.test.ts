import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { embedTexts, EmbeddingError, planBatches, embedModelName } from '../src/rag/embed.js';
import { runWithContext, type RequestContext } from '../src/runtime/request-context.js';
import { resetRouterTrace, usageToday, callsTodayFor } from '../src/providers/zerog-router.js';
import { fake0G } from './helpers/fake-0g.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => { process.env.ZEROG_API_KEY = 'sk-shared'; delete process.env.ZEROG_EMBED_MODEL; resetRouterTrace(); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ZEROG_API_KEY; delete process.env.ZEROG_EMBED_MODEL; });

describe('embedTexts → 0G /v1/embeddings', () => {
  it('posts {model, input[]} to the router with the shared key and returns Float32 vectors', async () => {
    const f = fake0G(); vi.stubGlobal('fetch', vi.fn(f.fetchImpl));
    const r = await embedTexts(['alpha beta', 'gamma delta']);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('https://router-api.0g.ai/v1/embeddings');
    expect(f.calls[0].body).toEqual({ model: 'qwen3-embedding-0.6b', input: ['alpha beta', 'gamma delta'] });
    expect(f.calls[0].body.chat_template_kwargs).toBeUndefined();
    expect(f.calls[0].auth).toBe('Bearer sk-shared');
    expect(r.vectors).toHaveLength(2);
    expect(r.vectors[0]).toBeInstanceOf(Float32Array);
    expect(r.dim).toBe(64);
    expect(r.model).toBe('qwen3-embedding-0.6b');
  });

  it('honours ZEROG_EMBED_MODEL', async () => {
    process.env.ZEROG_EMBED_MODEL = 'qwen3-embedding-8b';
    const f = fake0G(); vi.stubGlobal('fetch', vi.fn(f.fetchImpl));
    await embedTexts(['x y z']);
    expect(embedModelName()).toBe('qwen3-embedding-8b');
    expect(f.calls[0].body.model).toBe('qwen3-embedding-8b');
  });

  it('batches by count and by size, and keeps vector order', async () => {
    expect(planBatches(['a', 'b', 'c', 'd', 'e'], 2, 1e9)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(planBatches(['aaaa', 'bbbb', 'cc'], 10, 6)).toEqual([['aaaa'], ['bbbb', 'cc']]);
    expect(planBatches(['x'.repeat(50)], 10, 6)).toEqual([['x'.repeat(50)]]);
    const f = fake0G(); vi.stubGlobal('fetch', vi.fn(f.fetchImpl));
    const texts = Array.from({ length: 5 }, (_, i) => `text number${i} word${i}`);
    const r = await embedTexts(texts, { batchSize: 2 });
    expect(f.calls.map((c) => c.body.input.length)).toEqual([2, 2, 1]);
    const single = await embedTexts([texts[3]]);
    expect(Array.from(r.vectors[3])).toEqual(Array.from(single.vectors[0]));
    expect(r.requestIds).toHaveLength(3);
  });

  it('re-orders data by index', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] }), { status: 200 })));
    const r = await embedTexts(['first', 'second']);
    expect(Array.from(r.vectors[0])).toEqual([1, 0]);
  });

  it('captures the UUID request id and traces the call as kind "embedding" for the per-student cap', async () => {
    const f = fake0G(); vi.stubGlobal('fetch', vi.fn(f.fetchImpl));
    const ctx: RequestContext = { studentId: 'amy', calls: [] };
    const r = await runWithContext(ctx, () => embedTexts(['hello there']));
    expect(r.requestId).toMatch(UUID);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toMatchObject({ kind: 'embedding', requestId: r.requestId, studentId: 'amy', tokens: 5 });
    expect(callsTodayFor('amy')).toBe(1);
    expect(usageToday().calls).toBe(1);
  });

  it("bills a connected student's own key", async () => {
    const f = fake0G(); vi.stubGlobal('fetch', vi.fn(f.fetchImpl));
    await runWithContext({ studentId: 'amy', calls: [], zerogApiKey: 'sk-amy' }, () => embedTexts(['x y']));
    expect(f.calls[0].auth).toBe('Bearer sk-amy');
  });

  it('throws typed errors: no key, HTTP, network, timeout, bad response — and never leaks the key', async () => {
    delete process.env.ZEROG_API_KEY;
    const f0 = vi.fn(); vi.stubGlobal('fetch', f0);
    await expect(embedTexts(['x'])).rejects.toMatchObject({ name: 'EmbeddingError', kind: 'no-key' });
    expect(f0).not.toHaveBeenCalled();
    process.env.ZEROG_API_KEY = 'sk-shared';

    const cases: [() => Promise<Response>, string, number?][] = [
      [async () => new Response('{"error":"down"}', { status: 503 }), 'http', 503],
      [async () => { throw new TypeError('fetch failed'); }, 'network'],
      [async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, 'timeout'],
      [async () => new Response('not json', { status: 200 }), 'bad-response'],
      [async () => new Response(JSON.stringify({ data: [] }), { status: 200 }), 'bad-response'],
      [async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [] }] }), { status: 200 }), 'bad-response'],
    ];
    for (const [impl, kind, status] of cases) {
      vi.stubGlobal('fetch', vi.fn(impl));
      const err = await embedTexts(['x']).catch((e) => e);
      expect(err).toBeInstanceOf(EmbeddingError);
      expect(err.kind).toBe(kind);
      if (status) expect(err.status).toBe(status);
      expect(String(err.message)).not.toContain('sk-shared');
    }
  });

  it('makes no call for an empty input list', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect((await embedTexts([])).vectors).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
