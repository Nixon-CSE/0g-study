/**
 * P2.1: switching ZEROG_EMBED_MODEL rebuilds an index from its stored chunk text (all or nothing)
 * instead of mixing vectors or resetting the index (which used to drop every earlier note).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexNotes, embedInput, recallNotes, readPendingNotes } from '../src/rag/notes.js';
import { indexKbDoc, searchKb } from '../src/rag/kb.js';
import { chunkEmbedInput, ensureIndexModel } from '../src/rag/rebuild.js';
import { kbIndexFile, readIndex, studentIndexFile } from '../src/rag/store.js';
import { resetRouterTrace } from '../src/providers/zerog-router.js';
import { fake0G } from './helpers/fake-0g.js';

const BIO = '# Photosynthesis\nThe Calvin cycle uses RuBisCO to fix carbon dioxide into glucose.\n\n## Light reactions\nThylakoids make ATP and NADPH.';
const PHYS = "# Newton's laws\nForce equals mass times acceleration. Momentum is conserved in collisions.";
const ID1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

let dir: string;
let downFor: string | null = null;
let f0g: ReturnType<typeof fake0G>;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-rebuild-'));
  process.env.ZEROG_API_KEY = 'sk-shared';
  delete process.env.ZEROG_EMBED_MODEL;
  downFor = null;
  resetRouterTrace();
  f0g = fake0G();
  // Embeddings for `downFor` return 502 (like qwen3-embedding-0.6b on 2026-11-06).
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/embeddings') && downFor && JSON.parse(String(init.body)).model === downFor) {
      return new Response('{"error":{"type":"upstream_error"}}', { status: 502, headers: { 'x-request-id': 'gw, 00000000-0000-4000-8000-000000000001' } });
    }
    return f0g.fetchImpl(url, init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.ZEROG_API_KEY; delete process.env.ZEROG_EMBED_MODEL; });

const modelsSince = (n: number) => f0g.calls.slice(n).filter((c) => c.url.endsWith('/embeddings')).map((c) => c.body.model);

describe('switching the embeddings model', () => {
  it('chunkEmbedInput reproduces what was embedded (notes, KB)', () => {
    const notes = { heading: 'Photosynthesis', text: 'RuBisCO fixes CO2', source: { kind: 'notes', day: 'd', uploadId: ID1, title: 't' } as const };
    expect(chunkEmbedInput(notes)).toBe(embedInput(notes));
    expect(chunkEmbedInput({ ...notes, heading: '' })).toBe('RuBisCO fixes CO2');
    expect(chunkEmbedInput({ heading: 'H', text: 'x', source: { kind: 'kb', docId: 'd', title: 'Syllabus', version: '1' } })).toBe('Syllabus\nH\nx');
  });

  it('recall rebuilds the student index with the new model: same notes, only new-model vectors', async () => {
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO });
    await indexNotes(dir, 'alice', { uploadId: ID2, text: PHYS });
    const before = (await readIndex(studentIndexFile(dir, 'alice')))!;
    expect(before.model).toBe('qwen3-embedding-0.6b');
    process.env.ZEROG_EMBED_MODEL = 'qwen3.7-text-embedding';
    const n = f0g.calls.length;
    const { hits } = await recallNotes(dir, 'alice', 'Calvin cycle RuBisCO glucose');
    expect(hits[0].text).toContain('RuBisCO');
    expect(new Set(modelsSince(n))).toEqual(new Set(['qwen3.7-text-embedding']));
    const after = (await readIndex(studentIndexFile(dir, 'alice')))!;
    expect(after.model).toBe('qwen3.7-text-embedding');
    expect(after.chunks.map((c) => [c.id, c.text, c.source])).toEqual(before.chunks.map((c) => [c.id, c.text, c.source]));
    // Rebuilt once: a second recall embeds only the query.
    const m = f0g.calls.length;
    await recallNotes(dir, 'alice', 'momentum');
    expect(modelsSince(m)).toHaveLength(1);
  });

  it('a new upload after the switch keeps the earlier notes (no reset)', async () => {
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO });
    process.env.ZEROG_EMBED_MODEL = 'qwen3.7-text-embedding';
    await indexNotes(dir, 'alice', { uploadId: ID2, text: PHYS });
    const idx = (await readIndex(studentIndexFile(dir, 'alice')))!;
    expect(idx.model).toBe('qwen3.7-text-embedding');
    expect(new Set(idx.chunks.map((c) => c.source.kind === 'notes' && c.source.uploadId))).toEqual(new Set([ID1, ID2]));
  });

  it('new model down: the old index is left byte-for-byte untouched; the new note goes to pending', async () => {
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO });
    const file = studentIndexFile(dir, 'alice');
    const raw = fs.readFileSync(file, 'utf8');
    process.env.ZEROG_EMBED_MODEL = 'qwen3.7-text-embedding';
    downFor = 'qwen3.7-text-embedding';
    await expect(ensureIndexModel(file)).rejects.toMatchObject({ name: 'EmbeddingError', status: 502 });
    await expect(recallNotes(dir, 'alice', 'Calvin')).rejects.toMatchObject({ name: 'EmbeddingError' });
    await expect(indexNotes(dir, 'alice', { uploadId: ID2, text: PHYS })).rejects.toMatchObject({ name: 'EmbeddingError' });
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    expect((await readPendingNotes(dir, 'alice')).map((p) => p.uploadId)).toEqual([ID2]);
    // New model back: the next recall rebuilds, drains the pending note, and finds both.
    downFor = null;
    const { hits } = await recallNotes(dir, 'alice', 'Momentum conserved collisions');
    expect(hits[0].text).toContain('Momentum');
    expect((await readIndex(file))!.model).toBe('qwen3.7-text-embedding');
  });

  it('KB: other docs survive a model switch and search uses the new model', async () => {
    await indexKbDoc(dir, 'srv1', { docId: 'syl', title: 'Syllabus', content: '# Week 1\nPhotosynthesis and the Calvin cycle.', version: '1' });
    process.env.ZEROG_EMBED_MODEL = 'qwen3.7-text-embedding';
    await indexKbDoc(dir, 'srv1', { docId: 'rules', title: 'Rules', content: '# Exams\nNo calculators in the physics exam.', version: '1' });
    const idx = (await readIndex(kbIndexFile(dir, 'srv1')))!;
    expect(idx.model).toBe('qwen3.7-text-embedding');
    expect(new Set(idx.chunks.map((c) => c.source.kind === 'kb' && c.source.docId))).toEqual(new Set(['syl', 'rules']));
    const r = await searchKb(dir, 'srv1', 'Calvin cycle photosynthesis');
    expect(JSON.stringify(r)).toContain('Calvin');
  });
});
