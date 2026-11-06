import { dayKey } from '../study/store.js';
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

/**
 * Index transcribed notes for one student, keyed by uploadId, so re-reading the same photo replaces
 * its chunks instead of duplicating them. Throws EmbeddingError if 0G embeddings fail.
 */
export async function indexNotes(
  agentDir: string,
  userId: string,
  input: { uploadId: string; text: string; now?: Date },
): Promise<{ chunks: number; requestId: string | null; day: string }> {
  const file = studentIndexFile(agentDir, userId);
  const day = dayKey(input.now ?? new Date());
  const chunks = chunkMarkdown(input.text, NOTES_CHUNK);
  if (chunks.length === 0) return { chunks: 0, requestId: null, day };
  const emb = await embedTexts(chunks.map(embedInput));
  await upsertSource(
    file,
    { model: emb.model, dim: emb.dim },
    { kind: 'notes', day, uploadId: input.uploadId, title: notesTitle(input.text) },
    chunks.map((c, i) => ({ n: c.n, heading: c.heading, text: c.text, vector: emb.vectors[i] })),
    { onModelChange: 'reset' },
  );
  return { chunks: chunks.length, requestId: emb.requestId, day };
}

/** Search only this student's index. */
export async function recallNotes(agentDir: string, userId: string, query: string, opts: RankOptions = {}): Promise<{ hits: Hit[]; requestId: string | null }> {
  return searchIndex(studentIndexFile(agentDir, userId), query, opts);
}
