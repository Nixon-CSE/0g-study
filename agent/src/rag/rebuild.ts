import { embedModelName, embedTexts } from './embed.js';
import { encodeVector, readIndex, type RagIndex, type StoredChunk } from './store.js';
import { withFileLock } from '../study/store.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Switching ZEROG_EMBED_MODEL: an index built with another model is rebuilt from its stored chunk text,
 * all or nothing, before it is searched or added to. Vectors from two models are never mixed and no
 * note is dropped (the old behaviour reset the index on the first new upload). If the new model's
 * embeddings fail, the old index stays untouched and the error (EmbeddingError) propagates.
 */

/** Exactly the text that was embedded for a chunk (notes: heading + text; KB: title, heading + text). */
export function chunkEmbedInput(c: Pick<StoredChunk, 'heading' | 'text' | 'source'>): string {
  const body = c.heading ? `${c.heading}\n${c.text}` : c.text;
  return c.source.kind === 'kb' ? `${c.source.title}\n${body}` : body;
}

async function writeIndexAtomic(file: string, idx: RagIndex): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(idx));
  await fs.rename(tmp, file);
}

/** Make `file` use `model`, re-embedding every stored chunk if needed. Returns whether it rebuilt. */
export async function ensureIndexModel(file: string, model: string = embedModelName()): Promise<{ rebuilt: boolean; chunks: number }> {
  const quick = await readIndex(file);
  if (!quick || quick.model === model) return { rebuilt: false, chunks: quick?.chunks.length ?? 0 };
  return withFileLock(file, async () => {
    const idx = await readIndex(file);
    if (!idx || idx.model === model) return { rebuilt: false, chunks: idx?.chunks.length ?? 0 };
    if (idx.chunks.length === 0) {
      await writeIndexAtomic(file, { model, dim: 0, chunks: [] });
      return { rebuilt: true, chunks: 0 };
    }
    const emb = await embedTexts(idx.chunks.map(chunkEmbedInput), { model });
    const chunks = idx.chunks.map((c, i) => ({ ...c, vector: encodeVector(emb.vectors[i]) }));
    await writeIndexAtomic(file, { model: emb.model, dim: emb.dim, chunks });
    return { rebuilt: true, chunks: chunks.length };
  });
}
