import fs from 'node:fs/promises';
import path from 'node:path';
import { dayKey, isSafeId, UPLOAD_ID, withFileLock } from '../study/store.js';
import { UPLOAD_TTL_MS } from '../study/uploads.js';
import { loadUserKeys } from '../study/zerog-account.js';
import { runWithContext } from '../runtime/request-context.js';
import { log } from '../util/logger.js';
import { chunkMarkdown } from './chunk.js';
import { embedTexts } from './embed.js';
import { searchIndex, type Hit, type RankOptions } from './search.js';
import { studentIndexFile, upsertSource } from './store.js';

/** Study memory, phase 1: a student's own past notes. */
export const NOTES_CHUNK = { maxChars: 1200, overlap: 150 };

export function notesTitle(text: string): string {
  const first = text.split('\n').map((l) => l.replace(/^#+\s*/, '').replace(/[*_`]/g, '').trim()).find(Boolean) ?? 'notes';
  return first.slice(0, 80);
}

/** Text that gets embedded: the heading path gives a short chunk its topic. */
export const embedInput = (c: { heading: string; text: string }) => (c.heading ? `${c.heading}\n${c.text}` : c.text);

interface NotesSource { uploadId: string; text: string; day: string; title: string }

/** Chunk, embed and store one transcription. Throws EmbeddingError if 0G embeddings fail. */
async function indexSource(agentDir: string, userId: string, src: NotesSource): Promise<{ chunks: number; requestId: string | null }> {
  const chunks = chunkMarkdown(src.text, NOTES_CHUNK);
  if (chunks.length === 0) return { chunks: 0, requestId: null };
  const emb = await embedTexts(chunks.map(embedInput));
  await upsertSource(
    studentIndexFile(agentDir, userId),
    { model: emb.model, dim: emb.dim },
    { kind: 'notes', day: src.day, uploadId: src.uploadId, title: src.title },
    chunks.map((c, i) => ({ n: c.n, heading: c.heading, text: c.text, vector: emb.vectors[i] })),
    { onModelChange: 'reset' },
  );
  return { chunks: chunks.length, requestId: emb.requestId };
}

/**
 * Index transcribed notes for one student, keyed by uploadId, so re-reading the same photo replaces
 * its chunks instead of duplicating them. If indexing fails (0G embeddings down), the transcription is
 * kept in the student's pending file and indexed later (see drainPending), then the error is rethrown.
 */
export async function indexNotes(
  agentDir: string,
  userId: string,
  input: { uploadId: string; text: string; now?: Date },
): Promise<{ chunks: number; requestId: string | null; day: string }> {
  const now = input.now ?? new Date();
  const src: NotesSource = { uploadId: input.uploadId, text: input.text, day: dayKey(now), title: notesTitle(input.text) };
  try {
    const r = await indexSource(agentDir, userId, src);
    await removePending(agentDir, userId, src.uploadId);
    return { ...r, day: src.day };
  } catch (e) {
    try {
      await savePending(agentDir, userId, { ...src, createdAt: now.toISOString(), attempts: 1 });
    } catch (e2: any) {
      log.warn({ err: e2?.name }, 'study memory: could not save pending notes');
    }
    throw e;
  }
}

// ── pending notes: never lose a transcription to an embeddings outage ───────
/** Retries per pending entry before it is dropped (one attempt per drain). */
export const PENDING_MAX_ATTEMPTS = 6;

export interface PendingNote extends NotesSource {
  /** When the notes were first read (ISO). Entries older than the upload TTL are dropped. */
  createdAt: string;
  /** Indexing attempts so far, including the one that failed in read_notes. */
  attempts: number;
}

export function pendingFile(agentDir: string, userId: string): string {
  return path.join(path.dirname(studentIndexFile(agentDir, userId)), 'rag-pending.json');
}

const isPending = (x: any): x is PendingNote =>
  x && typeof x.uploadId === 'string' && UPLOAD_ID.test(x.uploadId) && typeof x.text === 'string'
  && typeof x.day === 'string' && typeof x.title === 'string' && typeof x.createdAt === 'string'
  && Number.isFinite(Date.parse(x.createdAt)) && Number.isInteger(x.attempts);

/** A missing or corrupt file reads as empty (the next write replaces it). Never logs note text. */
async function readPending(file: string): Promise<PendingNote[]> {
  let raw: string;
  try { raw = await fs.readFile(file, 'utf8'); } catch { return []; }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(isPending);
  } catch { /* fall through */ }
  log.warn('study memory: pending notes file is corrupt; ignoring it');
  return [];
}

/** Write-then-rename; an empty list removes the file. Call inside withFileLock(file). */
async function writePending(file: string, list: PendingNote[]): Promise<void> {
  if (list.length === 0) { await fs.rm(file, { force: true }); return; }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, file);
}

/** Add or replace (by uploadId) a pending entry. */
export async function savePending(agentDir: string, userId: string, entry: PendingNote): Promise<void> {
  const file = pendingFile(agentDir, userId);
  await withFileLock(file, async () => {
    const list = (await readPending(file)).filter((p) => p.uploadId !== entry.uploadId);
    await writePending(file, [...list, entry]);
  });
}

async function removePending(agentDir: string, userId: string, uploadId: string): Promise<void> {
  const file = pendingFile(agentDir, userId);
  try { await fs.access(file); } catch { return; }
  await withFileLock(file, async () => {
    const list = await readPending(file);
    if (list.some((p) => p.uploadId === uploadId)) await writePending(file, list.filter((p) => p.uploadId !== uploadId));
  });
}

export async function readPendingNotes(agentDir: string, userId: string): Promise<PendingNote[]> {
  return readPending(pendingFile(agentDir, userId));
}

/**
 * Index this student's pending notes. Idempotent by uploadId (indexing replaces a source's chunks).
 * Entries older than the upload TTL, or that failed PENDING_MAX_ATTEMPTS times, are dropped. Stops at
 * the first failure, so an outage costs one embedding attempt per drain, not one per entry.
 */
export async function drainPending(agentDir: string, userId: string, now: Date = new Date()): Promise<{ recovered: number; dropped: number; remaining: number }> {
  const file = pendingFile(agentDir, userId);
  try { await fs.access(file); } catch { return { recovered: 0, dropped: 0, remaining: 0 }; }
  return withFileLock(file, async () => {
    const list = await readPending(file);
    const keep: PendingNote[] = [];
    let recovered = 0, dropped = 0, failed = false;
    for (const p of list) {
      if (now.getTime() - Date.parse(p.createdAt) > UPLOAD_TTL_MS) { dropped++; continue; }
      if (failed) { keep.push(p); continue; }
      try {
        await indexSource(agentDir, userId, p);
        recovered++;
      } catch (e: any) {
        failed = true;
        const attempts = p.attempts + 1;
        if (attempts >= PENDING_MAX_ATTEMPTS) { dropped++; log.warn({ err: e?.name, status: e?.status }, 'study memory: dropping pending notes after repeated failures'); }
        else keep.push({ ...p, attempts });
      }
    }
    await writePending(file, keep);
    if (recovered || dropped) log.info({ recovered, dropped, remaining: keep.length }, 'study memory: pending notes drained');
    return { recovered, dropped, remaining: keep.length };
  });
}

/** Boot / hourly: drain every student's pending notes, each billed to that student's own key if connected. */
export async function drainAllPending(agentDir: string, now: Date = new Date()): Promise<number> {
  let users: string[];
  try { users = await fs.readdir(path.join(agentDir, 'study')); } catch { return 0; }
  let recovered = 0;
  for (const userId of users.filter(isSafeId)) {
    try {
      await fs.access(pendingFile(agentDir, userId));
    } catch { continue; }
    try {
      const keys = await loadUserKeys(agentDir, userId);
      const r = await runWithContext({ studentId: userId, calls: [], ...(keys ? { zerogApiKey: keys.apiKey } : {}) }, () => drainPending(agentDir, userId, now));
      recovered += r.recovered;
    } catch (e: any) {
      log.warn({ err: e?.name }, 'study memory: pending drain failed');
    }
  }
  return recovered;
}

/** Search only this student's index, after indexing any notes still pending from an outage. */
export async function recallNotes(agentDir: string, userId: string, query: string, opts: RankOptions = {}): Promise<{ hits: Hit[]; requestId: string | null }> {
  try { await drainPending(agentDir, userId); } catch (e: any) { log.warn({ err: e?.name }, 'study memory: pending drain failed'); }
  return searchIndex(studentIndexFile(agentDir, userId), query, opts);
}
