import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { buildApi, type ApiDeps } from '../src/api/server.js';
import { isAdminPath } from '../src/api/admin-auth.js';
import { fitBudget } from '../src/rag/kb.js';
import { resetRouterTrace } from '../src/providers/zerog-router.js';
import { fake0G } from './helpers/fake-0g.js';

const TOKEN = 'k'.repeat(48);
const SRV_A = '665f1c2b9a1e4b00000000aa';
const SRV_B = '665f1c2b9a1e4b00000000bb';
let dir: string;
let down = false;
let f0g: ReturnType<typeof fake0G>;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-kb-'));
  process.env.ZEROG_API_KEY = 'sk-shared';
  process.env.AGENT_ADMIN_TOKEN = TOKEN;
  down = false;
  resetRouterTrace();
  f0g = fake0G({ embeddingsDown: () => down });
  vi.stubGlobal('fetch', vi.fn(f0g.fetchImpl));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.ZEROG_API_KEY; delete process.env.AGENT_ADMIN_TOKEN;
});

function deps(): ApiDeps {
  const noop = async () => {};
  return {
    agentDir: dir, publicDir: dir, bus: new EventEmitter(),
    web: { enqueue: async () => 's', subscribe: () => () => {} } as any,
    evolutionMode: () => 'off', listSkills: () => [], reload: noop, restartMcp: noop,
    getConfig: () => ({}) as any, patchConfig: noop, patchTelegram: noop,
    tenantRegistry: { all: () => [], get: () => undefined } as any,
    resetSession: () => 0, memoryStats: () => ({ sessions: 0, messages: 0, vectors: 0 }),
  };
}
const app = () => buildApi(deps());
const post = (p: string, body: unknown, headers: Record<string, string> = { 'x-agent-admin-token': TOKEN }) =>
  app().request(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const SYLLABUS = '# Syllabus\nThe exam covers photosynthesis, the Calvin cycle and RuBisCO.\n\n## Dates\nThe final exam is on December 12.';
const RULES = '# House rules\nBe kind. No spam in the channels. Moderators can mute members.';

describe('/rag/kb admin routes', () => {
  it('are admin-only: 401 without or with a wrong token', async () => {
    expect(isAdminPath('/rag/kb/search')).toBe(true);
    for (const p of ['/rag/kb/index', '/rag/kb/delete', '/rag/kb/search']) {
      expect((await post(p, { serverId: SRV_A }, {})).status).toBe(401);
      expect((await post(p, { serverId: SRV_A }, { 'x-agent-admin-token': 'nope' })).status).toBe(401);
    }
    expect(f0g.calls).toHaveLength(0);
  });

  it('index → search returns a delimited, cited, budgeted block and the embedding request ids', async () => {
    const r = await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc1', title: 'Syllabus', content: SYLLABUS, version: 'v1' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, chunks: 2, requestIds: [expect.any(String)] });
    await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc2', title: 'House rules', content: RULES, version: 'v1' });
    const s = await (await post('/rag/kb/search', { serverId: SRV_A, query: 'When is the final exam date?' })).json();
    expect(s.block).toMatch(/^<knowledge_base trust="untrusted">/);
    expect(s.block).toContain('December 12');
    expect(s.block).toContain('[kb · Syllabus · #2]');
    expect(s.hits[0].citation).toBe('kb · Syllabus · #2');
    expect(s.versions).toEqual({ doc1: 'v1', doc2: 'v1' });
    expect(s.requestIds).toHaveLength(1);
  });

  it("server X's chunks never appear for server Y", async () => {
    await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc1', title: 'Syllabus', content: SYLLABUS, version: 'v1' });
    const s = await (await post('/rag/kb/search', { serverId: SRV_B, query: 'photosynthesis Calvin cycle RuBisCO exam' })).json();
    expect(s.block).toBeNull();
    expect(s.hits).toEqual([]);
    expect(s.versions).toEqual({});
    expect(fs.existsSync(path.join(dir, 'rag', 'kb', `${SRV_B}.json`))).toBe(false);
  });

  it('delete removes the doc chunks; re-index of a new version replaces them', async () => {
    await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc1', title: 'Syllabus', content: SYLLABUS, version: 'v1' });
    await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc1', title: 'Syllabus', content: '# Syllabus\nThe final exam moved to January 9.', version: 'v2' });
    let s = await (await post('/rag/kb/search', { serverId: SRV_A, query: 'final exam date' })).json();
    expect(s.versions).toEqual({ doc1: 'v2' });
    expect(s.block).toContain('January 9');
    expect(s.block).not.toContain('December 12');
    const d = await (await post('/rag/kb/delete', { serverId: SRV_A, docId: 'doc1' })).json();
    expect(d).toEqual({ ok: true, removed: 1 });
    s = await (await post('/rag/kb/search', { serverId: SRV_A, query: 'final exam date' })).json();
    expect(s).toMatchObject({ block: null, versions: {} });
  });

  it('validates ids and bodies (no path built from unchecked input)', async () => {
    for (const bad of ['../x', 'a/b', '', 'a.json']) {
      expect((await post('/rag/kb/index', { serverId: bad, docId: 'd', title: 't', content: 'c', version: '1' })).status).toBe(400);
      expect((await post('/rag/kb/search', { serverId: bad, query: 'q' })).status).toBe(400);
      expect((await post('/rag/kb/delete', { serverId: SRV_A, docId: bad })).status).toBe(400);
    }
    expect((await post('/rag/kb/index', 'not json')).status).toBe(400);
  });

  it('embeddings down → 503 (the backend falls back), with the indexed versions', async () => {
    await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc1', title: 'Syllabus', content: SYLLABUS, version: 'v1' });
    down = true;
    const s = await post('/rag/kb/search', { serverId: SRV_A, query: 'exam' });
    expect(s.status).toBe(503);
    expect((await s.json()).versions).toEqual({ doc1: 'v1' });
    expect((await post('/rag/kb/index', { serverId: SRV_A, docId: 'doc2', title: 'R', content: RULES, version: 'v1' })).status).toBe(503);
  });

  it('fitBudget keeps the best hits that fit', () => {
    const h = (text: string, score: number) => ({ text, heading: '', score, citation: 'c', source: { kind: 'kb', docId: 'd', title: 't', version: '1' } as const });
    expect(fitBudget([h('a'.repeat(600), 0.9), h('b'.repeat(600), 0.8), h('c'.repeat(100), 0.7)], 800).map((x) => x.score)).toEqual([0.9, 0.7]);
  });
});
