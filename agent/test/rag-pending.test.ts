/**
 * P2.1: notes are never lost to a 0G embeddings outage. A failed index leaves a pending entry
 * (study/<user>/rag-pending.json: notes text, never the image), drained before the student's next recall
 * and at boot / hourly, idempotently by uploadId.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeStudyTools } from '../src/tools/builtin/study.js';
import { saveUpload } from '../src/study/uploads.js';
import { runWithContext } from '../src/runtime/request-context.js';
import { readIndex, studentIndexFile } from '../src/rag/store.js';
import { drainAllPending, drainPending, indexNotes, pendingFile, readPendingNotes, recallNotes, savePending, PENDING_MAX_ATTEMPTS } from '../src/rag/notes.js';
import { resetRouterTrace } from '../src/providers/zerog-router.js';
import { fake0G } from './helpers/fake-0g.js';

const BIO = '# Photosynthesis\nThe Calvin cycle uses RuBisCO to fix carbon dioxide into glucose.\n\n## Light reactions\nThylakoids make ATP and NADPH.';
const PHYS = "# Newton's laws\nForce equals mass times acceleration. Momentum is conserved in collisions.";
const ID1 = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

let dir: string;
let down = false;
let f0g: ReturnType<typeof fake0G>;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-pending-'));
  process.env.ZEROG_API_KEY = 'sk-shared';
  down = false;
  resetRouterTrace();
  f0g = fake0G({ notesFor: () => BIO, embeddingsDown: () => down });
  vi.stubGlobal('fetch', vi.fn(f0g.fetchImpl));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(dir, { recursive: true, force: true }); delete process.env.ZEROG_API_KEY; });

const embedCalls = () => f0g.calls.filter((c) => c.url.endsWith('/embeddings')).length;
const chunksFor = async (user: string, uploadId: string) =>
  ((await readIndex(studentIndexFile(dir, user)))?.chunks ?? []).filter((c) => c.source.kind === 'notes' && c.source.uploadId === uploadId);

describe('pending notes', () => {
  it('fail → pending (text only, never the image) → recovered on the next recall, with the original day', async () => {
    down = true;
    const id = (await saveUpload(dir, 'data:image/png;base64,QklPTE9HWQ==') as any).id;
    const r: any = await runWithContext({ studentId: 'alice', calls: [] }, () =>
      makeStudyTools(dir).read_notes.execute({ uploadId: id }, { toolCallId: 't', messages: [] }));
    expect(r).toMatchObject({ ok: true, remembered: false });
    const pending = await readPendingNotes(dir, 'alice');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ uploadId: id, text: BIO, title: 'Photosynthesis', attempts: 1 });
    const raw = fs.readFileSync(pendingFile(dir, 'alice'), 'utf8');
    expect(raw).not.toMatch(/base64|data:image/);

    down = false;
    const { hits } = await recallNotes(dir, 'alice', 'Calvin cycle RuBisCO glucose');
    expect(hits[0]?.text).toContain('RuBisCO');
    expect(hits[0].citation).toBe(`notes · ${pending[0].day} · #1`);
    expect(fs.existsSync(pendingFile(dir, 'alice'))).toBe(false);
  });

  it('duplicates: failing twice for the same upload keeps one entry; draining twice indexes once', async () => {
    down = true;
    await expect(indexNotes(dir, 'alice', { uploadId: ID1, text: BIO })).rejects.toMatchObject({ name: 'EmbeddingError' });
    await expect(indexNotes(dir, 'alice', { uploadId: ID1, text: BIO })).rejects.toBeTruthy();
    expect(await readPendingNotes(dir, 'alice')).toHaveLength(1);
    down = false;
    expect(await drainPending(dir, 'alice')).toMatchObject({ recovered: 1, remaining: 0 });
    const n = (await chunksFor('alice', ID1)).length;
    expect(n).toBeGreaterThan(0);
    const before = embedCalls();
    expect(await drainPending(dir, 'alice')).toEqual({ recovered: 0, dropped: 0, remaining: 0 });
    expect(embedCalls()).toBe(before); // nothing pending: no 0G call
    // Re-indexing the same upload (e.g. a later successful read) replaces, never duplicates.
    await savePending(dir, 'alice', { uploadId: ID1, text: BIO, day: '2026-11-06', title: 't', createdAt: new Date().toISOString(), attempts: 1 });
    await drainPending(dir, 'alice');
    expect((await chunksFor('alice', ID1)).length).toBe(n);
  });

  it('a later successful index of the same upload clears its pending entry', async () => {
    down = true;
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO }).catch(() => {});
    down = false;
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO });
    expect(fs.existsSync(pendingFile(dir, 'alice'))).toBe(false);
  });

  it('a corrupt pending file is ignored (recall still works) and replaced on the next failure', async () => {
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO });
    fs.writeFileSync(pendingFile(dir, 'alice'), '{not json');
    const { hits } = await recallNotes(dir, 'alice', 'Calvin cycle RuBisCO');
    expect(hits.length).toBeGreaterThan(0);
    fs.writeFileSync(pendingFile(dir, 'alice'), JSON.stringify([{ uploadId: '../../x', text: 1 }, 'junk']));
    expect(await readPendingNotes(dir, 'alice')).toEqual([]);
    down = true;
    await indexNotes(dir, 'alice', { uploadId: ID2, text: PHYS }).catch(() => {});
    expect((await readPendingNotes(dir, 'alice')).map((p) => p.uploadId)).toEqual([ID2]);
  });

  it("per student: bob's recall never drains or reads alice's pending notes; drainAll indexes each into its own index", async () => {
    down = true;
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO }).catch(() => {});
    await indexNotes(dir, 'bob', { uploadId: ID2, text: PHYS }).catch(() => {});
    down = false;
    const { hits } = await recallNotes(dir, 'bob', 'Calvin cycle RuBisCO glucose');
    expect(hits.every((h) => !h.text.includes('RuBisCO'))).toBe(true);
    expect(await readPendingNotes(dir, 'alice')).toHaveLength(1);
    expect(await drainAllPending(dir)).toBe(1); // only alice is left
    expect((await chunksFor('alice', ID1)).length).toBeGreaterThan(0);
    expect(await chunksFor('alice', ID2)).toEqual([]);
    expect(await chunksFor('bob', ID1)).toEqual([]);
    expect((await chunksFor('bob', ID2)).length).toBeGreaterThan(0);
  });

  it('still down: one attempt per drain (stops at the first failure); dropped after the attempt cap or the 24 h TTL', async () => {
    down = true;
    await indexNotes(dir, 'alice', { uploadId: ID1, text: BIO }).catch(() => {});
    await indexNotes(dir, 'alice', { uploadId: ID2, text: PHYS }).catch(() => {});
    const before = embedCalls();
    expect(await drainPending(dir, 'alice')).toMatchObject({ recovered: 0, remaining: 2 });
    expect(embedCalls() - before).toBe(3); // one entry, three HTTP attempts (retries), then stop
    expect((await readPendingNotes(dir, 'alice')).map((p) => p.attempts)).toEqual([2, 1]);
    for (let i = 0; i < PENDING_MAX_ATTEMPTS; i++) await drainPending(dir, 'alice');
    expect((await readPendingNotes(dir, 'alice')).map((p) => p.uploadId)).toEqual([ID2]);

    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await savePending(dir, 'alice', { uploadId: ID1, text: BIO, day: '2026-11-05', title: 't', createdAt: old, attempts: 1 });
    down = false;
    expect(await drainPending(dir, 'alice')).toMatchObject({ recovered: 1, dropped: 1, remaining: 0 });
    expect(await chunksFor('alice', ID1)).toEqual([]);
  });
});
