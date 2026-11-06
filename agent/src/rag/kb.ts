import { chunkMarkdown } from './chunk.js';
import { embedTexts } from './embed.js';
import { embedInput } from './notes.js';
import { formatRetrievedBlock, searchIndex, type Hit } from './search.js';
import { kbIndexFile, readIndex, removeSource, upsertSource } from './store.js';
import { ensureIndexModel } from './rebuild.js';

/**
 * Study memory, phase 2: a server's knowledge-base documents. One index per serverId, so server X's
 * chunks can never be returned for server Y. Driven by the BonFire backend through admin-only routes;
 * the backend holds no 0G key.
 */
export const KB_CHUNK = { maxChars: 1200, overlap: 150 };
export const KB_DEFAULT_BUDGET_BYTES = 8 * 1024;

export async function indexKbDoc(
  agentDir: string, serverId: string,
  doc: { docId: string; title: string; content: string; version: string },
): Promise<{ chunks: number; requestId: string | null }> {
  const file = kbIndexFile(agentDir, serverId);
  const chunks = chunkMarkdown(doc.content, KB_CHUNK);
  const source = { kind: 'kb' as const, docId: doc.docId, title: doc.title, version: doc.version };
  if (chunks.length === 0) {
    await removeSource(file, `kb:${doc.docId}`);
    return { chunks: 0, requestId: null };
  }
  // A model switch re-embeds the server's other docs first, so they are kept, not reset.
  await ensureIndexModel(file);
  // The title goes into the embedded text so a short chunk still knows which document it belongs to.
  const emb = await embedTexts(chunks.map((c) => `${doc.title}\n${embedInput(c)}`));
  await upsertSource(
    file, { model: emb.model, dim: emb.dim }, source,
    chunks.map((c, i) => ({ n: c.n, heading: c.heading, text: c.text, vector: emb.vectors[i] })),
    { onModelChange: 'reset' },
  );
  return { chunks: chunks.length, requestId: emb.requestId };
}

export async function deleteKbDoc(agentDir: string, serverId: string, docId: string): Promise<number> {
  return removeSource(kbIndexFile(agentDir, serverId), `kb:${docId}`);
}

/** docId → indexed version, so the caller can index missing/stale docs and drop deleted ones. */
export async function kbVersions(agentDir: string, serverId: string): Promise<Record<string, string>> {
  const idx = await readIndex(kbIndexFile(agentDir, serverId));
  const out: Record<string, string> = {};
  for (const c of idx?.chunks ?? []) if (c.source.kind === 'kb') out[c.source.docId] = c.source.version;
  return out;
}

/** Keep the best hits that fit in `maxBytes` of passage text. Pure; exported for tests. */
export function fitBudget(hits: Hit[], maxBytes: number): Hit[] {
  const out: Hit[] = [];
  let used = 0;
  for (const h of hits) {
    const size = Buffer.byteLength(h.text, 'utf8') + Buffer.byteLength(h.heading, 'utf8');
    if (used + size > maxBytes) continue;
    out.push(h);
    used += size;
  }
  return out;
}

export async function searchKb(
  agentDir: string, serverId: string, query: string,
  opts: { k?: number; maxBytes?: number; minScore?: number } = {},
): Promise<{ hits: Hit[]; block: string | null; requestId: string | null }> {
  const { hits, requestId } = await searchIndex(kbIndexFile(agentDir, serverId), query, { k: opts.k ?? 6, minScore: opts.minScore ?? 0.3 });
  const kept = fitBudget(hits, opts.maxBytes ?? KB_DEFAULT_BUDGET_BYTES);
  return { hits: kept, block: kept.length ? formatRetrievedBlock(kept, 'knowledge_base') : null, requestId };
}
