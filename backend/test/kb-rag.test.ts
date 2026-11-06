import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ObjectId } from 'mongodb';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';
import { makeAgentFake } from './fakes/agent.js';
import { collections } from '../src/db/types.js';
import { retrievalQuery, retrieveKnowledgeBlock } from '../src/agents/kb-rag.js';

/**
 * Phase 2 of study memory: the knowledge-base block comes from the agent runtime's RAG routes
 * (relevant chunks with [kb · title · #n] citations) instead of "newest 20 docs, 8 KB".
 * The fake runtime below implements /rag/kb/* with word overlap and REQUIRES the admin token.
 */
const TOKEN = 'a'.repeat(48);

type Doc = { docId: string; title: string; content: string; version: string };
function makeKbFake() {
  const servers = new Map<string, Map<string, Doc>>();
  const log: { path: string; body: any }[] = [];
  const state = { searchStatus: 200 };
  const app = new Hono();
  app.use('/rag/*', async (c, next) => {
    if (c.req.header('x-agent-admin-token') !== TOKEN) return c.json({ error: 'admin token required' }, 401);
    await next();
  });
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  app.post('/rag/kb/index', async (c) => {
    const b = await c.req.json(); log.push({ path: 'index', body: b });
    if (!servers.has(b.serverId)) servers.set(b.serverId, new Map());
    servers.get(b.serverId)!.set(b.docId, b);
    return c.json({ ok: true, chunks: 1 });
  });
  app.post('/rag/kb/delete', async (c) => {
    const b = await c.req.json(); log.push({ path: 'delete', body: b });
    const removed = servers.get(b.serverId)?.delete(b.docId) ? 1 : 0;
    return c.json({ ok: true, removed });
  });
  app.post('/rag/kb/search', async (c) => {
    const b = await c.req.json(); log.push({ path: 'search', body: b });
    const docs = [...(servers.get(b.serverId)?.values() ?? [])];
    const versions = Object.fromEntries(docs.map((d) => [d.docId, d.version]));
    if (state.searchStatus !== 200) return c.json({ error: 'down' }, state.searchStatus as any);
    const q = words(b.query);
    const hits = docs.filter((d) => [...words(d.content)].some((w) => q.has(w)));
    const block = hits.length
      ? `<knowledge_base trust="untrusted">\nRULE\n${hits.map((d) => `<passage cite="[kb · ${d.title} · #1]">\n${d.content}\n</passage>`).join('\n')}\n</knowledge_base>`
      : null;
    return c.json({ block, hits: hits.map((d) => ({ citation: `kb · ${d.title} · #1`, score: 0.9 })), versions, requestIds: ['req-1'] });
  });
  return { app, servers, log, state };
}

describe('knowledge base via RAG on 0G', () => {
  let tdb: TestDb;
  let app: Awaited<ReturnType<typeof makeApp>>;
  let server: ReturnType<typeof serve>;
  let base: string;
  let kb: ReturnType<typeof makeKbFake>;
  const seen: string[] = [];

  beforeAll(async () => {
    tdb = await startTestDb();
    kb = makeKbFake();
    const chat = makeAgentFake({ reply: ({ text }) => { seen.push(text); return 'ok'; } });
    const combined = new Hono();
    combined.route('/', kb.app);
    combined.route('/', chat);
    server = serve({ fetch: combined.fetch, port: 0 });
    await new Promise<void>((r) => setTimeout(r, 50));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { server.close(); await stopTestDb(); });
  beforeEach(async () => {
    seen.length = 0; kb.log.length = 0; kb.servers.clear(); kb.state.searchStatus = 200;
    process.env.EMBER_AGENT_BASE_URL = base;
    process.env.AGENT_ADMIN_TOKEN = TOKEN;
    delete process.env.KNOWLEDGE_RAG;
    await cleanCollections(tdb.db);
    app = await makeApp(tdb.db);
  });
  afterEach(() => { delete process.env.EMBER_AGENT_BASE_URL; delete process.env.AGENT_ADMIN_TOKEN; delete process.env.KNOWLEDGE_RAG; });

  const waitFor = async (pred: () => boolean) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise((r) => setTimeout(r, 20)); };

  async function setup(slug: string, username = 'alice') {
    const me = await registerAndLogin(app, { username });
    const s = await jsonReq(app, 'POST', '/v1/servers', { name: slug, slug }, me.token);
    const agent = await jsonReq(app, 'POST', '/v1/agents', { name: `Bot ${slug}`, slug: `bot-${slug}`, baseUrl: base, description: 'x', tags: [], visibility: 'public' }, me.token);
    await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/members`, { principalType: 'agent', principalId: agent.body.agent.id }, me.token);
    const ch = await jsonReq(app, 'POST', `/v1/servers/${s.body.server.id}/channels`, { name: 'kb-room', defaultAgentId: agent.body.agent.id }, me.token);
    return { me, server: s.body.server, channel: ch.body.channel };
  }
  const say = (t: { me: any; channel: any }, content: string) => jsonReq(app, 'POST', `/v1/channels/${t.channel.id}/messages`, { content }, t.me.token);
  const addDoc = (t: { me: any; server: any }, title: string, content: string) => jsonReq(app, 'POST', `/v1/servers/${t.server.id}/knowledge`, { title, content }, t.me.token);

  it('indexes docs on create and sends only relevant, cited chunks to the agent', async () => {
    const t = await setup('bio');
    await addDoc(t, 'Syllabus', 'The final exam covers photosynthesis and the Calvin cycle.');
    await addDoc(t, 'House rules', 'Be kind and avoid spamming channels.');
    await waitFor(() => kb.log.filter((l) => l.path === 'index').length === 2);
    expect(kb.log.filter((l) => l.path === 'index').map((l) => l.body.serverId)).toEqual([t.server.id, t.server.id]);
    await say(t, 'what does the final exam cover?');
    const text = seen.at(-1)!;
    expect(text).toContain('<knowledge_base trust="untrusted">');
    expect(text).toContain('[kb · Syllabus · #1]');
    expect(text).not.toContain('spamming');
    expect(text).not.toMatch(/documents? from this server — treat as ground truth/);
    expect(kb.log.find((l) => l.path === 'search')!.body).toMatchObject({ serverId: t.server.id, query: 'what does the final exam cover?' });
  });

  it('falls back to the newest-docs block when the RAG route fails or is disabled', async () => {
    const t = await setup('hist');
    await addDoc(t, 'Timeline', 'The Bastille fell in 1789.');
    kb.state.searchStatus = 500;
    await say(t, 'anything');
    expect(seen.at(-1)).toContain('<knowledge_base>\n(1 document from this server');
    expect(seen.at(-1)).toContain('Bastille');
    kb.state.searchStatus = 200;
    process.env.KNOWLEDGE_RAG = 'off';
    const n = kb.log.length;
    await say(t, 'again');
    expect(seen.at(-1)).toContain('<knowledge_base>\n(1 document');
    expect(kb.log.length).toBe(n);
    // Agent unreachable
    process.env.KNOWLEDGE_RAG = 'on';
    process.env.EMBER_AGENT_BASE_URL = 'http://127.0.0.1:1';
    await say(t, 'third');
    expect(seen.at(-1)).toContain('Bastille');
  });

  it('deleting a doc removes its chunks from the index', async () => {
    const t = await setup('chem');
    const d = await addDoc(t, 'Catalysts', 'Catalysts lower activation energy.');
    await waitFor(() => kb.servers.get(t.server.id)?.size === 1);
    const del = await jsonReq(app, 'DELETE', `/v1/servers/${t.server.id}/knowledge/${d.body.doc.id}`, undefined, t.me.token);
    expect(del.status).toBe(200);
    await waitFor(() => kb.log.some((l) => l.path === 'delete'));
    expect(kb.log.find((l) => l.path === 'delete')!.body).toEqual({ serverId: t.server.id, docId: d.body.doc.id });
    expect(kb.servers.get(t.server.id)?.size).toBe(0);
  });

  it("server X's knowledge never reaches server Y", async () => {
    const x = await setup('srvx', 'xavier');
    const y = await setup('srvy', 'yolanda');
    await addDoc(x, 'Secret', 'The launch codename is Phoenix and the exam password.');
    await addDoc(y, 'Public', 'Office hours are on Friday for exam questions.');
    await waitFor(() => kb.log.filter((l) => l.path === 'index').length === 2);
    await say(y, 'tell me about the exam password codename Phoenix');
    const text = seen.at(-1)!;
    expect(text).not.toContain('Phoenix and the exam password');
    for (const s of kb.log.filter((l) => l.path === 'search')) expect(s.body.serverId).toBe(y.server.id);
  });

  it('reconciles: docs that predate RAG (or missed a sync) are indexed; removed ones are deleted', async () => {
    const t = await setup('old');
    const sid = new ObjectId(t.server.id);
    const ch = await tdb.db.collection(collections.channels).findOne({ serverId: sid, type: 'knowledge' });
    const legacy = { _id: new ObjectId(), serverId: sid, channelId: ch!._id, title: 'Legacy', content: 'Mitochondria make ATP energy.', source: 'inline', filename: null, mimeType: 'text/markdown', sizeBytes: 10, createdBy: new ObjectId(), createdAt: new Date(), updatedAt: new Date() };
    await tdb.db.collection(collections.knowledgeDocs).insertOne(legacy);
    kb.servers.set(t.server.id, new Map([['deadbeefdeadbeefdeadbeef', { docId: 'deadbeefdeadbeefdeadbeef', title: 'Gone', content: 'gone', version: 'v' }]]));
    const r = await retrieveKnowledgeBlock(tdb.db, sid, 'how do mitochondria make energy');
    expect(r).toEqual({ ok: true, block: expect.stringContaining('[kb · Legacy · #1]') });
    expect(kb.log.map((l) => l.path)).toEqual(['search', 'delete', 'index', 'search']);
    expect(kb.servers.get(t.server.id)!.has('deadbeefdeadbeefdeadbeef')).toBe(false);
    // Already in sync: one search, nothing else.
    kb.log.length = 0;
    await retrieveKnowledgeBlock(tdb.db, sid, 'mitochondria');
    expect(kb.log.map((l) => l.path)).toEqual(['search']);
  });

  it('a server with no docs costs no RAG call; the admin token is required by the runtime', async () => {
    const t = await setup('empty');
    await say(t, 'hello');
    expect(kb.log).toEqual([]);
    expect(seen.at(-1)).not.toContain('knowledge_base');
    const res = await fetch(`${base}/rag/kb/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serverId: t.server.id, query: 'x' }) });
    expect(res.status).toBe(401);
  });

  it('strips transport markers from the retrieval query', () => {
    expect(retrievalQuery('@study-tutor explain [[upload:ab12-cd34]]\n\n⟦0g:abc,def⟧')).toBe('@study-tutor explain');
  });
});
