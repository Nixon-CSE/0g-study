import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeTracedFetch, drainRouterCalls, usageToday, resetRouterTrace, callsTodayFor } from '../src/providers/zerog-router.js';
import { runWithContext } from '../src/runtime/request-context.js';
import { formatRequestIdMarker } from '../src/runtime/agent.js';

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

describe('traced router fetch', () => {
  beforeEach(() => resetRouterTrace());

  it('captures the request id header and token usage', async () => {
    const f = makeTracedFetch(async () => json({ id: 'chatcmpl-body', usage: { total_tokens: 42 } }, { 'x-request-id': 'req-123' }));
    await f('https://router/v1/chat/completions');
    const [c] = drainRouterCalls();
    expect(c).toMatchObject({ requestId: 'req-123', tokens: 42, status: 200, kind: 'chat' });
  });

  it('falls back to the body id when the header is absent', async () => {
    const f = makeTracedFetch(async () => json({ id: 'chatcmpl-body', usage: { total_tokens: 7 } }));
    await f('https://router/v1/chat/completions');
    expect(drainRouterCalls()[0].requestId).toBe('chatcmpl-body');
  });

  it('records null id and 0 tokens for non-JSON bodies, and the body stays readable', async () => {
    const f = makeTracedFetch(async () => new Response('plain', { status: 502, headers: { 'content-type': 'text/plain' } }));
    const res = await f('https://router/v1/other');
    expect(await res.text()).toBe('plain');
    expect(drainRouterCalls()[0]).toMatchObject({ requestId: null, tokens: 0, status: 502, kind: 'other' });
  });

  it('tolerates malformed JSON', async () => {
    const f = makeTracedFetch(async () => new Response('{nope', { headers: { 'content-type': 'application/json', 'x-request-id': 'r1' } }));
    await f('https://router/v1/chat/completions');
    expect(drainRouterCalls()[0]).toMatchObject({ requestId: 'r1', tokens: 0 });
  });

  it('aggregates today usage and per-student counts', async () => {
    const f = makeTracedFetch(async () => json({ usage: { total_tokens: 10 } }, { 'x-request-id': 'r' }));
    await runWithContext({ studentId: 'alice', calls: [] }, async () => { await f('https://router/v1/chat/completions'); await f('https://router/v1/chat/completions'); });
    await runWithContext({ studentId: 'bob', calls: [] }, async () => { await f('https://router/v1/chat/completions'); });
    expect(usageToday()).toMatchObject({ calls: 3, tokens: 30 });
    expect(callsTodayFor('alice')).toBe(2);
    expect(callsTodayFor('bob')).toBe(1);
  });

  it('keeps concurrent turns separate via the request context', async () => {
    const f = makeTracedFetch(async (u) => json({}, { 'x-request-id': String(u).split('?')[1] }));
    const a = { studentId: 'a', calls: [] as any[] };
    const b = { studentId: 'b', calls: [] as any[] };
    await Promise.all([
      runWithContext(a, async () => { await new Promise((r) => setTimeout(r, 5)); await f('https://router/v1/chat/completions?A'); }),
      runWithContext(b, async () => { await f('https://router/v1/chat/completions?B'); }),
    ]);
    expect(a.calls.map((c) => c.requestId)).toEqual(['A']);
    expect(b.calls.map((c) => c.requestId)).toEqual(['B']);
  });
});

describe('formatRequestIdMarker', () => {
  it('joins ids and omits when none', () => {
    expect(formatRequestIdMarker(['a', null, 'b'])).toBe('\n\n⟦0g:a,b⟧');
    expect(formatRequestIdMarker([null])).toBe('');
    expect(formatRequestIdMarker([])).toBe('');
  });

  it('carries the router\'s x-0g-e2ee value per request id, verbatim (P4)', async () => {
    expect(formatRequestIdMarker([{ requestId: 'a', e2ee: 'sealed' }, { requestId: 'b', e2ee: 'none' }, { requestId: 'c', e2ee: null }, { requestId: null, e2ee: 'sealed' }]))
      .toBe('\n\n⟦0g:a~sealed,b~none,c⟧');
    expect(formatRequestIdMarker([{ requestId: 'a', e2ee: 'Sealed;x' }])).toBe('\n\n⟦0g:a⟧');
    resetRouterTrace();
    const f = makeTracedFetch(async () => json({ usage: { total_tokens: 1 } }, { 'x-request-id': 'r1', 'x-0g-e2ee': 'sealed' }));
    const g = makeTracedFetch(async () => json({ usage: { total_tokens: 1 } }, { 'x-request-id': 'r2', 'x-0g-e2ee': 'none' }));
    const h = makeTracedFetch(async () => json({ usage: { total_tokens: 1 } }, { 'x-request-id': 'r3', 'x-0g-e2ee': '<script>' }));
    const ctx = { calls: [] as any[] };
    await runWithContext(ctx, async () => { await f('https://router/v1/embeddings'); await g('https://router/v1/chat/completions'); await h('https://router/v1/chat/completions'); });
    expect(ctx.calls.map((c) => c.e2ee)).toEqual(['sealed', 'none', null]);
    expect(formatRequestIdMarker(ctx.calls)).toBe('\n\n⟦0g:r1~sealed,r2~none,r3⟧');
  });

  it('carries the model next to each request id (P5-iAI step 5)', async () => {
    expect(formatRequestIdMarker([{ requestId: 'a', e2ee: 'sealed', model: 'glm-5.3' }, { requestId: 'b', e2ee: null, model: 'gemini-2.5-flash' }, { requestId: 'c', model: 'bad model⟧' }]))
      .toBe('\n\n⟦0g:a~sealed~glm-5.3,b~~gemini-2.5-flash,c⟧');
    resetRouterTrace();
    const said = makeTracedFetch(async () => json({ model: 'deepseek-v4.1-flash', usage: { total_tokens: 1 } }, { 'x-request-id': 'r1', 'x-0g-e2ee': 'none' }));
    const silent = makeTracedFetch(async () => json({ usage: { total_tokens: 1 } }, { 'x-request-id': 'r2' }));
    const ctx = { calls: [] as any[] };
    await runWithContext(ctx, async () => {
      await said('https://router/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'requested-model' }) });
      await silent('https://router/v1/embeddings', { method: 'POST', body: JSON.stringify({ model: 'qwen3-embedding-0.6b' }) });
    });
    expect(ctx.calls.map((c) => c.model)).toEqual(['deepseek-v4.1-flash', 'qwen3-embedding-0.6b']);
  });
});

import { pickRequestId, withThinkingOff } from '../src/providers/zerog-router.js';
describe('router quirks', () => {
  it('keeps one id when the router sends two X-Request-Id headers', () => {
    expect(pickRequestId('0360f46149f57d88, e7d78c2d-c2eb-41d8-af03-eb60abdcf64b')).toBe('e7d78c2d-c2eb-41d8-af03-eb60abdcf64b');
    expect(pickRequestId('abc123')).toBe('abc123');
    expect(pickRequestId(null)).toBeNull();
  });
  it('disables thinking on chat completions only', async () => {
    const seen: any[] = [];
    const f = withThinkingOff((async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return new Response('{}'); }) as any);
    await f('https://r/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4.1-flash' }) });
    await f('https://r/v1/models', { method: 'POST', body: JSON.stringify({ model: 'deepseek-v4.1-flash' }) });
    expect(seen[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(seen[1].chat_template_kwargs).toBeUndefined();
  });
  it('does not send chat_template_kwargs to models that reject it', async () => {
    const seen: any[] = [];
    const f = withThinkingOff((async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return new Response('{}'); }) as any);
    await f('https://r/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-5.4-mini' }) });
    await f('https://r/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'qwen2.5-vl-72b-instruct' }) });
    expect(seen[0].chat_template_kwargs).toBeUndefined();
    expect(seen[1].chat_template_kwargs).toEqual({ enable_thinking: false });
  });
  describe('gemini', () => {
    const OFF = { google: { thinking_config: { thinking_budget: 0 } } };
    const run = async (url: string, body: object) => {
      const seen: any[] = [];
      const f = withThinkingOff((async (_u: any, init: any) => { seen.push(JSON.parse(init.body)); return new Response('{}'); }) as any);
      await f(url, { method: 'POST', body: JSON.stringify(body) });
      return seen[0];
    };
    const CHAT = 'https://r/v1/chat/completions';
    afterEach(() => { delete process.env.ZEROG_THINKING; });

    it('sets a zero thinking budget on gemini chat calls, keeping the rest of the body', async () => {
      const tools = [{ type: 'function', function: { name: 't' } }];
      const b = await run(CHAT, { model: 'gemini-2.5-flash', max_tokens: 1500, tools });
      expect(b).toEqual({ model: 'gemini-2.5-flash', max_tokens: 1500, tools, extra_body: OFF });
      expect(b.chat_template_kwargs).toBeUndefined();
      expect((await run(CHAT, { model: 'Gemini-3.5-Flash' })).extra_body).toEqual(OFF);
    });
    it('only gemini, only chat completions; a caller-set extra_body is kept', async () => {
      expect((await run(CHAT, { model: 'deepseek-v4.1-flash' })).extra_body).toBeUndefined();
      expect((await run(CHAT, { model: 'gpt-5.4-mini' })).extra_body).toBeUndefined();
      expect((await run('https://r/v1/models', { model: 'gemini-2.5-flash' })).extra_body).toBeUndefined();
      const own = { google: { thinking_config: { thinking_budget: 512 } } };
      expect((await run(CHAT, { model: 'gemini-2.5-flash', extra_body: own })).extra_body).toEqual(own);
    });
    it('ZEROG_THINKING=on leaves gemini thinking on', async () => {
      process.env.ZEROG_THINKING = 'on';
      expect((await run(CHAT, { model: 'gemini-2.5-flash' })).extra_body).toBeUndefined();
    });
  });
});

describe("0G's own request id (x_0g_trace)", () => {
  const UUID = '8f5e7c69-d405-4c88-9e82-cfeb2dadde5b';
  const res = (body: object, headers: Record<string, string>) => async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  it('uses x_0g_trace.request_id — the UUID the router bills under — over the headers', async () => {
    resetRouterTrace();
    const f = makeTracedFetch(res({ x_0g_trace: { request_id: UUID }, usage: { total_tokens: 3 } }, { 'x-request-id': `1fcb49b7a5c6d9ed, ${UUID}` }) as any);
    await f('https://router/v1/chat/completions');
    expect(drainRouterCalls()[0].requestId).toBe(UUID);
  });
  it('falls back to the header UUID when the body has no trace, and ignores a malformed trace id', async () => {
    resetRouterTrace();
    await makeTracedFetch(res({}, { 'x-request-id': `1fcb49b7a5c6d9ed, ${UUID}` }) as any)('https://router/v1/embeddings');
    await makeTracedFetch(res({ x_0g_trace: { request_id: '<script>' } }, { 'x-request-id': `1fcb49b7a5c6d9ed, ${UUID}` }) as any)('https://router/v1/embeddings');
    expect(drainRouterCalls().map((c) => c.requestId)).toEqual([UUID, UUID]);
  });
});

import { readFileSync } from 'node:fs';
import { tenantLlm } from '../src/providers/zerog-router.js';
describe('Examiner model', () => {
  const baked = JSON.parse(readFileSync(new URL('../data/tenants.json', import.meta.url), 'utf8')) as { slug: string; llm: { model?: string } }[];
  const model = (slug: string) => baked.find((t) => t.slug === slug)?.llm.model;

  it('the image ships the Examiner on 0gm-1.0; the Note Reader and Tutor keep the default', () => {
    expect(model('study-examiner')).toBe('0gm-1.0-35b-a3b');
    expect(model('study-tutor')).toBeUndefined();
    expect(model('study-note-reader')).toBeUndefined();
  });

  it('ZEROG_EXAMINER_MODEL overrides the Examiner and nobody else', () => {
    const llm = { provider: 'zerog-router', model: '0gm-1.0-35b-a3b' };
    expect(tenantLlm('study-examiner', llm, 'deepseek-v4.1-flash')).toEqual({ ...llm, model: 'deepseek-v4.1-flash' });
    expect(tenantLlm('study-examiner', llm, '  ')).toBe(llm);
    expect(tenantLlm('study-examiner', llm, undefined)).toBe(llm);
    expect(tenantLlm('study-tutor', {}, 'deepseek-v4.1-flash')).toEqual({});
  });

  it('the badge marker carries the 0gm id', () => {
    expect(formatRequestIdMarker([{ requestId: 'a', e2ee: 'sealed', model: '0gm-1.0-35b-a3b' }])).toBe('\n\n⟦0g:a~sealed~0gm-1.0-35b-a3b⟧');
  });
});
