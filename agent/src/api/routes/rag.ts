import { Hono } from 'hono';
import { z } from 'zod';
import { SAFE_ID } from '../../study/store.js';
import { deleteKbDoc, indexKbDoc, kbVersions, searchKb } from '../../rag/kb.js';
import { runWithContext, type RequestContext } from '../../runtime/request-context.js';
import { log } from '../../util/logger.js';

/**
 * Knowledge-base RAG for BonFire servers. Admin-only: `/rag` is in ADMIN_PREFIXES, so these need
 * `x-agent-admin-token` (the backend's agentFetch adds it). Every call is scoped by serverId.
 *   POST /rag/kb/index   {serverId, docId, title, content, version}
 *   POST /rag/kb/delete  {serverId, docId}
 *   POST /rag/kb/search  {serverId, query, k?, maxBytes?} → {block, hits, versions, requestIds}
 */
const Id = z.string().regex(SAFE_ID);
const IndexBody = z.object({
  serverId: Id, docId: Id,
  title: z.string().min(1).max(200),
  content: z.string().max(600 * 1024),
  version: z.string().min(1).max(64),
});
const DeleteBody = z.object({ serverId: Id, docId: Id });
const SearchBody = z.object({
  serverId: Id,
  query: z.string().max(8000),
  k: z.number().int().min(1).max(12).optional(),
  maxBytes: z.number().int().min(512).max(64 * 1024).optional(),
});

export function ragRoutes(agentDir: string) {
  const app = new Hono();
  const body = async (c: any) => c.req.json().catch(() => null);

  app.post('/rag/kb/index', async (c) => {
    const p = IndexBody.safeParse(await body(c));
    if (!p.success) return c.json({ error: 'invalid body', issues: p.error.issues }, 400);
    const ctx: RequestContext = { calls: [] };
    try {
      const r = await runWithContext(ctx, () => indexKbDoc(agentDir, p.data.serverId, p.data));
      return c.json({ ok: true, chunks: r.chunks, requestIds: ctx.calls.map((x) => x.requestId).filter(Boolean) });
    } catch (e: any) {
      log.warn({ err: e?.name, kind: e?.kind, status: e?.status }, 'kb rag: index failed');
      return c.json({ error: '0G embeddings unavailable' }, 503);
    }
  });

  app.post('/rag/kb/delete', async (c) => {
    const p = DeleteBody.safeParse(await body(c));
    if (!p.success) return c.json({ error: 'invalid body', issues: p.error.issues }, 400);
    return c.json({ ok: true, removed: await deleteKbDoc(agentDir, p.data.serverId, p.data.docId) });
  });

  app.post('/rag/kb/search', async (c) => {
    const p = SearchBody.safeParse(await body(c));
    if (!p.success) return c.json({ error: 'invalid body', issues: p.error.issues }, 400);
    const ctx: RequestContext = { calls: [] };
    try {
      const r = await runWithContext(ctx, () => searchKb(agentDir, p.data.serverId, p.data.query, p.data));
      return c.json({
        block: r.block,
        hits: r.hits.map((h) => ({ citation: h.citation, score: h.score })),
        versions: await kbVersions(agentDir, p.data.serverId),
        requestIds: ctx.calls.map((x) => x.requestId).filter(Boolean),
      });
    } catch (e: any) {
      log.warn({ err: e?.name, kind: e?.kind, status: e?.status }, 'kb rag: search failed');
      return c.json({ error: '0G embeddings unavailable', versions: await kbVersions(agentDir, p.data.serverId) }, 503);
    }
  });

  return app;
}
