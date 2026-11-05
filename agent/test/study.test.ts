import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeStreak, logStudySet, studyStats, isSafeId } from '../src/study/store.js';
import { saveUpload, readUpload, purgeOldUploads, MAX_UPLOAD_CHARS } from '../src/study/uploads.js';
import { makeStudyTools } from '../src/tools/builtin/study.js';
import { runWithContext } from '../src/runtime/request-context.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'study-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreak({ '2026-11-03': 1, '2026-11-04': 2, '2026-11-05': 3 }, D('2026-11-05'))).toBe(3);
  });
  it('stops at a gap', () => {
    expect(computeStreak({ '2026-11-01': 1, '2026-11-04': 2, '2026-11-05': 3 }, D('2026-11-05'))).toBe(2);
  });
  it('does not break when today is not studied yet', () => {
    expect(computeStreak({ '2026-11-03': 1, '2026-11-04': 2 }, D('2026-11-05'))).toBe(2);
  });
  it('is 0 when yesterday and today are empty', () => {
    expect(computeStreak({ '2026-11-01': 1 }, D('2026-11-05'))).toBe(0);
  });
});

describe('study_log + stats', () => {
  it('creates, appends, and keeps users independent', async () => {
    const now = D('2026-11-05');
    await logStudySet(dir, 'alice', { topic: 't', cards: cards(6) }, now);
    await logStudySet(dir, 'alice', { topic: 't2', cards: cards(2) }, now);
    await logStudySet(dir, 'bob', { topic: 't', cards: cards(1) }, D('2026-11-04'));
    expect(await studyStats(dir, 'alice', now)).toEqual({ streak: 1, today: 8, totalCards: 8 });
    expect(await studyStats(dir, 'bob', now)).toEqual({ streak: 1, today: 0, totalCards: 1 });
    expect(await studyStats(dir, 'nobody', now)).toEqual({ streak: 0, today: 0, totalCards: 0 });
    expect(fs.existsSync(path.join(dir, 'study', 'alice', '2026-11-05.json'))).toBe(true);
  });
  it('rejects unsafe user ids', async () => {
    expect(isSafeId('../etc')).toBe(false);
    await expect(logStudySet(dir, '../etc', { topic: 't', cards: cards(1) })).rejects.toThrow();
  });
  it('study_log tool uses the per-turn student and refuses without one', async () => {
    const { study_log } = makeStudyTools(dir);
    const exec = (study_log as any).execute;
    expect(await exec({ topic: 't', cards: cards(1) }, {})).toMatchObject({ ok: false });
    const r = await runWithContext({ studentId: 'carol', calls: [] }, () => exec({ topic: 't', cards: cards(3) }, {}));
    expect(r).toMatchObject({ ok: true, savedCards: 3 });
    expect((await studyStats(dir, 'carol')).today).toBe(3);
  });
});

describe('uploads', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  it('stores a valid image under a random id and reads it back', async () => {
    const r = await saveUpload(dir, png);
    expect(r.ok).toBe(true);
    if (r.ok) expect(await readUpload(dir, r.id)).toBe(png);
  });
  it('rejects wrong type, non-string, and oversize', async () => {
    expect(await saveUpload(dir, 'data:image/gif;base64,AAAA')).toMatchObject({ ok: false, status: 400 });
    expect(await saveUpload(dir, 'data:text/html;base64,AAAA')).toMatchObject({ ok: false, status: 400 });
    expect(await saveUpload(dir, 123)).toMatchObject({ ok: false, status: 400 });
    expect(await saveUpload(dir, 'data:image/png;base64,' + 'A'.repeat(MAX_UPLOAD_CHARS))).toMatchObject({ ok: false, status: 413 });
  });
  it('refuses bad ids (path traversal)', async () => {
    expect(await readUpload(dir, '../../etc/passwd')).toBeNull();
    expect(await readUpload(dir, 'deadbeef-0000')).toBeNull();
  });
  it('read_notes reports a clear failure for a missing upload', async () => {
    process.env.ZEROG_API_KEY = 'k';
    const { read_notes } = makeStudyTools(dir);
    const r: any = await (read_notes as any).execute({ uploadId: 'deadbeef-0000' }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/couldn't read the notes/);
  });
  it('purges uploads older than 24h only', async () => {
    const r = await saveUpload(dir, png);
    if (!r.ok) throw new Error();
    expect(await purgeOldUploads(dir, Date.now())).toBe(0);
    expect(await purgeOldUploads(dir, Date.now() + 25 * 3600 * 1000)).toBe(1);
    expect(await readUpload(dir, r.id)).toBeNull();
  });
});
