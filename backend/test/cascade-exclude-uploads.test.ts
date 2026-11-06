/**
 * P2: the backend forwards the cascade root's [[upload:…]] ids to EVERY hop as `excludeUploadIds`
 * (through agentFetch, i.e. with the admin token for the platform runtime), so the Tutor's and
 * Examiner's recall_notes never return the photo being studied as an "earlier note".
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { startTestDb, stopTestDb, cleanCollections, type TestDb } from './helpers/db.js';
import { makeApp, jsonReq } from './helpers/app.js';
import { registerAndLogin } from './helpers/auth.js';

interface Seen { slug: string; body: any; adminToken: string | null }
const seen: Seen[] = [];

function podAgent(slug: string, reply: string) {
  const app = new Hono();
  const pending = new Map<string, string>();
  app.post('/chat/message', async (c) => {
    seen.push({ slug, body: await c.req.json(), adminToken: c.req.header('x-agent-admin-token') ?? null });
    const id = `s_${Math.random().toString(36).slice(2)}`;
    pending.set(id, reply);
    return c.json({ streamId: id });
  });
  app.get('/chat/stream/:id', (c) => {
    const out = pending.get(c.req.param('id')) ?? '';
    return stream(c, async (s) => { s.write(`data: ${JSON.stringify({ chunk: out })}\n\n`); s.write('event: done\ndata: {}\n\n'); });
  });
  return app;
}

const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('cascade forwards excludeUploadIds from the root message', () => {
  let tdb: TestDb;
  const servers: ReturnType<typeof serve>[] = [];
  const port: Record<string, number> = {};
  const saved = { token: process.env.AGENT_ADMIN_TOKEN, base: process.env.EMBER_AGENT_BASE_URL };

  beforeAll(async () => {
    tdb = await startTestDb();
    for (const [slug, reply] of [
      ['study-note-reader', '# Notes\nCalvin cycle.\n\n@study-tutor'],
      ['study-tutor', 'Explanation.\n\n**Flashcards**\n1. Q: What does RuBisCO do? — A: Fixes CO2.\n\n@study-examiner'],
      ['study-examiner', 'Question: why does RuBisCO matter?'],
    ] as const) {
      const s = serve({ fetch: podAgent(slug, reply).fetch, port: 0 });
      servers.push(s);
    }
    await new Promise((r) => setTimeout(r, 50));
    ['study-note-reader', 'study-tutor', 'study-examiner'].forEach((slug, i) => { port[slug] = (servers[i].address() as any).port; });
  });
  afterAll(async () => { servers.forEach((s) => s.close()); await stopTestDb(); });
  beforeEach(async () => { await cleanCollections(tdb.db); seen.length = 0; });
  afterEach(() => {
    if (saved.token === undefined) delete process.env.AGENT_ADMIN_TOKEN; else process.env.AGENT_ADMIN_TOKEN = saved.token;
    if (saved.base === undefined) delete process.env.EMBER_AGENT_BASE_URL; else process.env.EMBER_AGENT_BASE_URL = saved.base;
  });

  async function setupPod() {
    const app = await makeApp(tdb.db);
    const me = await registerAndLogin(app, { username: 'alice' });
    const server = await jsonReq(app, 'POST', '/v1/servers', { name: 'Study', slug: 'study' }, me.token);
    for (const slug of Object.keys(port)) {
      const a = await jsonReq(app, 'POST', '/v1/agents', {
        name: slug, slug, baseUrl: `http://127.0.0.1:${port[slug]}`, description: '.', tags: [], visibility: 'public',
      }, me.token);
      await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/members`, { principalType: 'agent', principalId: a.body.agent.id }, me.token);
    }
    const ch = await jsonReq(app, 'POST', `/v1/servers/${server.body.server.id}/channels`, { name: 'study' }, me.token);
    return { app, me, channel: ch.body.channel };
  }

  it('reader, tutor and examiner all get the root ids (valid ids only), with the student id', async () => {
    const { app, me, channel } = await setupPod();
    const post = await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: `@study-note-reader [[upload:${A}]] [[upload:${B}]] [[upload:NOT-VALID]]` }, me.token);
    expect(post.status).toBe(201);
    expect(post.body.replies).toHaveLength(3);
    expect(seen.map((s) => s.slug)).toEqual(['study-note-reader', 'study-tutor', 'study-examiner']);
    for (const s of seen) {
      expect(s.body.excludeUploadIds).toEqual([A, B]);
      expect(typeof s.body.studentId).toBe('string');
    }
    // The tutor's invocation text has no marker of its own: only the forwarded ids exclude the photo.
    expect(seen[1].body.text).not.toContain('[[upload:');
    // The examiner receives the tutor's flashcards in its text.
    expect(seen[2].body.text).toContain('Q: What does RuBisCO do?');
  });

  it('a question without markers forwards nothing (earlier photos stay recallable)', async () => {
    const { app, me, channel } = await setupPod();
    await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`,
      { content: '@study-tutor how does the Calvin cycle connect to what I studied earlier?' }, me.token);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.body).not.toHaveProperty('excludeUploadIds');
  });

  it('goes through agentFetch: the admin token is attached for the platform runtime only', async () => {
    process.env.AGENT_ADMIN_TOKEN = 't'.repeat(48);
    process.env.EMBER_AGENT_BASE_URL = `http://127.0.0.1:${port['study-note-reader']}`;
    const { app, me, channel } = await setupPod();
    await jsonReq(app, 'POST', `/v1/channels/${channel.id}/messages`, { content: `@study-note-reader [[upload:${A}]]` }, me.token);
    const reader = seen.find((s) => s.slug === 'study-note-reader')!;
    expect(reader.body.excludeUploadIds).toEqual([A]);
    expect(reader.adminToken).toBe('t'.repeat(48));
    // Another host never gets the token (its excludeUploadIds would be ignored by a real runtime).
    expect(seen.find((s) => s.slug === 'study-tutor')!.adminToken).toBeNull();
  });
});
