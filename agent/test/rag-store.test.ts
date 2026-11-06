import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  upsertSource, removeSource, readIndex, encodeVector, decodeVector, studentIndexFile, kbIndexFile,
  RagIndexMismatchError, type RagSource,
} from '../src/rag/store.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-store-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const vec = (...xs: number[]) => Float32Array.from(xs);
const notes = (uploadId: string, day = '2026-11-05'): RagSource => ({ kind: 'notes', day, uploadId, title: 't' });
const META = { model: 'm1', dim: 3 };

describe('vector encoding', () => {
  it('round-trips Float32 exactly, including from unaligned buffers', () => {
    const v = vec(0.1, -2.5, 3e-8, Number.MAX_VALUE / 1e30);
    expect(Array.from(decodeVector(encodeVector(v)))).toEqual(Array.from(v));
    const sub = new Float32Array(vec(9, 1, 2, 3).buffer, 4, 3);
    expect(Array.from(decodeVector(encodeVector(sub)))).toEqual([1, 2, 3]);
  });
});

describe('index files', () => {
  it('per-student and per-server paths are confined and validated', () => {
    expect(studentIndexFile(dir, 'alice')).toBe(path.join(dir, 'study', 'alice', 'rag.json'));
    expect(kbIndexFile(dir, '665f1c2b9a1e4b0012345678')).toBe(path.join(dir, 'rag', 'kb', '665f1c2b9a1e4b0012345678.json'));
    for (const bad of ['../bob', 'a/b', '.', '', 'x'.repeat(65), 'a.json', '..']) {
      expect(() => studentIndexFile(dir, bad)).toThrow();
      expect(() => kbIndexFile(dir, bad)).toThrow();
    }
  });

  it('round-trips chunks and is idempotent per source', async () => {
    const f = studentIndexFile(dir, 'alice');
    await upsertSource(f, META, notes('u1'), [{ n: 1, heading: 'H', text: 'one', vector: vec(1, 0, 0) }, { n: 2, heading: 'H', text: 'two', vector: vec(0, 1, 0) }]);
    await upsertSource(f, META, notes('u2'), [{ n: 1, heading: '', text: 'other', vector: vec(0, 0, 1) }]);
    // re-index u1 with different content: replaces, never duplicates
    await upsertSource(f, META, notes('u1'), [{ n: 1, heading: 'H', text: 'one v2', vector: vec(1, 1, 0) }]);
    const idx = (await readIndex(f))!;
    expect(idx.model).toBe('m1');
    expect(idx.dim).toBe(3);
    expect(idx.chunks.map((c) => c.text).sort()).toEqual(['one v2', 'other']);
    const c = idx.chunks.find((x) => x.text === 'one v2')!;
    expect(c.id).toBe('notes:u1#1');
    expect(Array.from(decodeVector(c.vector))).toEqual([1, 1, 0]);
  });

  it('rejects vectors whose dimension differs from the declared one', async () => {
    const f = studentIndexFile(dir, 'alice');
    await expect(upsertSource(f, META, notes('u1'), [{ n: 1, heading: '', text: 'x', vector: vec(1, 2) }])).rejects.toBeInstanceOf(RagIndexMismatchError);
    expect(await readIndex(f)).toBeNull();
  });

  it('never mixes models: rejects by default, or starts a fresh index on reset', async () => {
    const f = studentIndexFile(dir, 'alice');
    await upsertSource(f, META, notes('u1'), [{ n: 1, heading: '', text: 'old', vector: vec(1, 0, 0) }]);
    await expect(upsertSource(f, { model: 'm2', dim: 3 }, notes('u2'), [{ n: 1, heading: '', text: 'x', vector: vec(1, 0, 0) }]))
      .rejects.toBeInstanceOf(RagIndexMismatchError);
    await expect(upsertSource(f, { model: 'm1', dim: 4 }, notes('u2'), [{ n: 1, heading: '', text: 'x', vector: vec(1, 0, 0, 0) }]))
      .rejects.toBeInstanceOf(RagIndexMismatchError);
    const r = await upsertSource(f, { model: 'm2', dim: 2 }, notes('u2'), [{ n: 1, heading: '', text: 'new', vector: vec(1, 0) }], { onModelChange: 'reset' });
    expect(r.reset).toBe(true);
    const idx = (await readIndex(f))!;
    expect(idx).toMatchObject({ model: 'm2', dim: 2 });
    expect(idx.chunks.map((c) => c.text)).toEqual(['new']);
  });

  it('loses nothing under 40 concurrent writes to the same index', async () => {
    const f = studentIndexFile(dir, 'alice');
    await Promise.all(Array.from({ length: 40 }, (_, i) =>
      upsertSource(f, META, notes(`up-${i}`), [{ n: 1, heading: '', text: `t${i}`, vector: vec(i, 1, 0) }])));
    const idx = (await readIndex(f))!;
    expect(idx.chunks).toHaveLength(40);
    expect(new Set(idx.chunks.map((c) => c.text)).size).toBe(40);
    expect(fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith('.tmp'))).toEqual([]);
  });

  it('removeSource deletes only that source', async () => {
    const f = kbIndexFile(dir, 'srv1');
    const kb = (docId: string): RagSource => ({ kind: 'kb', docId, title: docId, version: 'v1' });
    await upsertSource(f, META, kb('d1'), [{ n: 1, heading: '', text: 'a', vector: vec(1, 0, 0) }, { n: 2, heading: '', text: 'b', vector: vec(0, 1, 0) }]);
    await upsertSource(f, META, kb('d2'), [{ n: 1, heading: '', text: 'c', vector: vec(0, 0, 1) }]);
    expect(await removeSource(f, 'kb:d1')).toBe(2);
    expect(await removeSource(f, 'kb:nope')).toBe(0);
    expect((await readIndex(f))!.chunks.map((c) => c.text)).toEqual(['c']);
    expect(await removeSource(kbIndexFile(dir, 'empty'), 'kb:d1')).toBe(0);
  });

  it('treats a corrupt index file as empty instead of crashing', async () => {
    const f = studentIndexFile(dir, 'alice');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{not json');
    expect(await readIndex(f)).toBeNull();
    await upsertSource(f, META, notes('u1'), [{ n: 1, heading: '', text: 'ok', vector: vec(1, 0, 0) }]);
    expect((await readIndex(f))!.chunks).toHaveLength(1);
  });
});
