import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { UPLOAD_ID } from './store.js';

export const MAX_UPLOAD_CHARS = 8_000_000; // ~6 MB of image once base64-decoded
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 413; error: string };

/** Pure validation; null when the data URL is acceptable. */
export function checkUpload(dataUrl: unknown): { status: 400 | 413; error: string } | null {
  if (typeof dataUrl !== 'string') return { status: 400, error: 'dataUrl required' };
  if (dataUrl.length > MAX_UPLOAD_CHARS) return { status: 413, error: 'image too large' };
  if (!DATA_URL.test(dataUrl)) return { status: 400, error: 'dataUrl must be a png/jpeg/webp base64 data URL' };
  return null;
}

/** Validate and store a notes photo. Filenames are always server-generated UUIDs. */
export async function saveUpload(agentDir: string, dataUrl: unknown): Promise<UploadResult> {
  const bad = checkUpload(dataUrl);
  if (bad) return { ok: false, ...bad };
  const url = dataUrl as string;
  const id = crypto.randomUUID();
  const dir = path.join(agentDir, 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.txt`), url);
  return { ok: true, id };
}

/** Read a stored upload; null when the id is malformed or missing. */
export async function readUpload(agentDir: string, id: string): Promise<string | null> {
  if (!UPLOAD_ID.test(id)) return null;
  try { return await fs.readFile(path.join(agentDir, 'uploads', `${id}.txt`), 'utf8'); }
  catch { return null; }
}

/** Delete uploads older than the TTL (NFR1/NFR4). Returns the number removed. */
export async function purgeOldUploads(agentDir: string, now: number = Date.now()): Promise<number> {
  const dir = path.join(agentDir, 'uploads');
  let n = 0;
  let files: string[] = [];
  try { files = await fs.readdir(dir); } catch { return 0; }
  for (const f of files) {
    const p = path.join(dir, f);
    try {
      const st = await fs.stat(p);
      if (now - st.mtimeMs > UPLOAD_TTL_MS) { await fs.unlink(p); n++; }
    } catch { /* raced with another purge */ }
  }
  return n;
}
