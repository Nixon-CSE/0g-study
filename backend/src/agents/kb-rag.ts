import type { Db, ObjectId } from 'mongodb';
import { collections, type KnowledgeDocDoc } from '../db/types.js';
import { agentFetch } from './admin-token.js';
import { log } from '../util/logger.js';

/**
 * Knowledge-base retrieval (RAG on 0G). The engine lives in the agent runtime, which holds the 0G key;
 * the backend never gets one. It calls the runtime's admin-only routes (/rag/kb/*) through agentFetch,
 * which attaches AGENT_ADMIN_TOKEN only for the platform runtime (EMBER_AGENT_BASE_URL).
 *
 * Enabled when EMBER_AGENT_BASE_URL is set and KNOWLEDGE_RAG is not "off". Any failure is reported
 * as { ok: false } and the invoker falls back to the old "newest docs" block.
 */
const MAX_SYNC_PER_TURN = 10;
const SEARCH_TIMEOUT_MS = 20_000;
const INDEX_TIMEOUT_MS = 45_000;

export function kbRagBaseUrl(): string | null {
  if ((process.env.KNOWLEDGE_RAG ?? 'on').toLowerCase() === 'off') return null;
  const u = process.env.EMBER_AGENT_BASE_URL;
  return u ? u.replace(/\/+$/, '') : null;
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<{ status: number; json: any }> {
  const base = kbRagBaseUrl();
  if (!base) throw new Error('knowledge RAG disabled');
  const res = await agentFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const versionOf = (d: Pick<KnowledgeDocDoc, 'updatedAt'>) => d.updatedAt.toISOString();

/** Strip transport markers so they don't steer retrieval. */
export function retrievalQuery(text: string): string {
  return (text ?? '').replace(/⟦0g:[^⟧]*⟧/g, '').replace(/\[\[upload:[A-Za-z0-9-]+\]\]/g, '').trim().slice(0, 4000);
}

export async function kbIndexDoc(doc: KnowledgeDocDoc): Promise<boolean> {
  const r = await post('/rag/kb/index', {
    serverId: doc.serverId.toHexString(), docId: doc._id.toHexString(),
    title: doc.title, content: doc.content, version: versionOf(doc),
  }, INDEX_TIMEOUT_MS);
  return r.status === 200;
}

export async function kbDeleteDoc(serverId: ObjectId, docId: ObjectId): Promise<boolean> {
  const r = await post('/rag/kb/delete', { serverId: serverId.toHexString(), docId: docId.toHexString() }, SEARCH_TIMEOUT_MS);
  return r.status === 200;
}

/** Fire-and-forget index/delete from the knowledge routes; a miss is repaired on the next retrieval. */
export function kbSyncInBackground(what: string, fn: () => Promise<boolean>): void {
  if (!kbRagBaseUrl()) return;
  fn().then(
    (ok) => { if (!ok) log.warn({ what }, 'knowledge RAG: sync refused; will reconcile on next retrieval'); },
    (err) => log.warn({ what, err: String(err?.message ?? err) }, 'knowledge RAG: sync failed; will reconcile on next retrieval'),
  );
}

export type KbRetrieval = { ok: true; block: string | null } | { ok: false; reason: string };

/**
 * Top-k knowledge chunks for `query`, as a delimited, cited block (or null when nothing is relevant).
 * Reconciles first: docs missing or stale in the agent's index are (re)indexed, deleted ones removed.
 */
export async function retrieveKnowledgeBlock(db: Db, serverId: ObjectId, query: string): Promise<KbRetrieval> {
  if (!kbRagBaseUrl()) return { ok: false, reason: 'disabled' };
  try {
    const docs = await db.collection<KnowledgeDocDoc>(collections.knowledgeDocs)
      .find({ serverId }, { projection: { _id: 1, updatedAt: 1 } })
      .toArray();
    if (docs.length === 0) return { ok: true, block: null };
    const q = retrievalQuery(query);
    const sid = serverId.toHexString();
    const search = () => post('/rag/kb/search', { serverId: sid, query: q }, SEARCH_TIMEOUT_MS);

    let r = await search();
    if (r.status !== 200 && !(r.status === 503 && r.json?.versions)) return { ok: false, reason: `search HTTP ${r.status}` };
    const versions: Record<string, string> = r.json?.versions ?? {};
    const live = new Map(docs.map((d) => [d._id.toHexString(), versionOf(d)]));
    const stale = docs.filter((d) => versions[d._id.toHexString()] !== versionOf(d));
    const removed = Object.keys(versions).filter((id) => !live.has(id));

    if (stale.length || removed.length) {
      for (const id of removed) await post('/rag/kb/delete', { serverId: sid, docId: id }, SEARCH_TIMEOUT_MS);
      const toIndex = stale.slice(0, MAX_SYNC_PER_TURN).map((d) => d._id);
      const full = await db.collection<KnowledgeDocDoc>(collections.knowledgeDocs).find({ _id: { $in: toIndex }, serverId }).toArray();
      for (const d of full) {
        if (!(await kbIndexDoc(d))) return { ok: false, reason: 'index failed' };
      }
      if (stale.length > MAX_SYNC_PER_TURN) log.info({ serverId: sid, pending: stale.length - MAX_SYNC_PER_TURN }, 'knowledge RAG: more docs to index next turn');
      r = await search();
    }
    if (r.status !== 200) return { ok: false, reason: `search HTTP ${r.status}` };
    return { ok: true, block: typeof r.json?.block === 'string' && r.json.block ? r.json.block : null };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  }
}
