import fs from 'node:fs/promises';
import path from 'node:path';
import { isSafeId, withFileLock } from '../study/store.js';

/**
 * RAG index files. One JSON file per owner, so isolation is structural: a student's search only ever
 * opens `<agentDir>/study/<userId>/rag.json`, and a server's KB search opens `<agentDir>/rag/kb/<serverId>.json`.
 * Owner ids pass `isSafeId` ([A-Za-z0-9_-], no dots or slashes), so a path can never leave its directory.
 *
 * An index has exactly one embedding model + dimension. Vectors from another model are never mixed in:
 * `upsertSource` rejects a mismatched batch, or (onModelChange: 'reset') starts a fresh index.
 * Writes are serialized per file (withFileLock) and atomic (write-then-rename).
 */
export type RagSource =
  | { kind: 'notes'; day: string; uploadId: string; title: string }
  | { kind: 'kb'; docId: string; title: string; version: string };

export interface StoredChunk {
  id: string;
  source: RagSource;
  /** 1-based chunk number within its source (used in citations). */
  n: number;
  heading: string;
  text: string;
  /** base64 of the Float32Array bytes. */
  vector: string;
}

export interface RagIndex { model: string; dim: number; chunks: StoredChunk[] }

export interface NewChunk { n: number; heading: string; text: string; vector: Float32Array }

export class RagIndexMismatchError extends Error {
  constructor(message: string) { super(message); this.name = 'RagIndexMismatchError'; }
}

export function encodeVector(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
}

export function decodeVector(s: string): Float32Array {
  const buf = Buffer.from(s, 'base64');
  const ab = new ArrayBuffer(buf.length - (buf.length % 4));
  new Uint8Array(ab).set(buf.subarray(0, ab.byteLength));
  return new Float32Array(ab);
}

export function sourceKey(s: RagSource): string {
  return s.kind === 'notes' ? `notes:${s.uploadId}` : `kb:${s.docId}`;
}

export function studentIndexFile(agentDir: string, userId: string): string {
  if (!isSafeId(userId)) throw new Error('invalid user id');
  return path.join(agentDir, 'study', userId, 'rag.json');
}

export function kbIndexFile(agentDir: string, serverId: string): string {
  if (!isSafeId(serverId)) throw new Error('invalid server id');
  return path.join(agentDir, 'rag', 'kb', `${serverId}.json`);
}

export async function readIndex(file: string): Promise<RagIndex | null> {
  try {
    const j = JSON.parse(await fs.readFile(file, 'utf8'));
    if (j && typeof j.model === 'string' && typeof j.dim === 'number' && Array.isArray(j.chunks)) return j as RagIndex;
  } catch { /* missing or corrupt: treat as empty */ }
  return null;
}

async function writeIndex(file: string, idx: RagIndex): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(idx));
  await fs.rename(tmp, file);
}

/**
 * Replace every chunk of `source` with `chunks` (idempotent: re-indexing the same upload or doc
 * version replaces it, never duplicates it).
 */
export async function upsertSource(
  file: string,
  meta: { model: string; dim: number },
  source: RagSource,
  chunks: NewChunk[],
  opts: { onModelChange?: 'reject' | 'reset' } = {},
): Promise<{ chunks: number; reset: boolean }> {
  for (const c of chunks) {
    if (c.vector.length !== meta.dim) throw new RagIndexMismatchError(`vector dim ${c.vector.length} != ${meta.dim}`);
  }
  return withFileLock(file, async () => {
    let idx = await readIndex(file);
    let reset = false;
    if (idx && (idx.model !== meta.model || idx.dim !== meta.dim)) {
      if (opts.onModelChange !== 'reset') {
        throw new RagIndexMismatchError(`index is ${idx.model}/${idx.dim}, got ${meta.model}/${meta.dim}`);
      }
      idx = null;
      reset = true;
    }
    const cur: RagIndex = idx ?? { model: meta.model, dim: meta.dim, chunks: [] };
    const key = sourceKey(source);
    cur.chunks = cur.chunks.filter((c) => sourceKey(c.source) !== key);
    for (const c of chunks) {
      cur.chunks.push({ id: `${key}#${c.n}`, source, n: c.n, heading: c.heading, text: c.text, vector: encodeVector(c.vector) });
    }
    await writeIndex(file, cur);
    return { chunks: chunks.length, reset };
  });
}

/** Remove every chunk of one source. Returns the number removed. */
export async function removeSource(file: string, key: string): Promise<number> {
  return withFileLock(file, async () => {
    const idx = await readIndex(file);
    if (!idx) return 0;
    const before = idx.chunks.length;
    idx.chunks = idx.chunks.filter((c) => sourceKey(c.source) !== key);
    const removed = before - idx.chunks.length;
    if (removed) await writeIndex(file, idx);
    return removed;
  });
}
