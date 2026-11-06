import crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { isSafeId } from './store.js';
import { allowedOrigins } from '../config/production.js';

/**
 * NFR1: protect the Study Pod endpoints (/uploads, /usage, /study/index).
 *
 * The browser already holds a BonFire backend JWT (HS256, `sub` = user ObjectId hex — the same id the
 * backend forwards as `studentId`). Set STUDY_JWT_SECRET to the backend's JWT_SECRET and the agent
 * verifies that token itself, so no new browser-side secret is needed and a user can only read
 * their own streak.
 *
 * When STUDY_JWT_SECRET is unset the routes stay open (local dev only) — boot logs a warning.
 * STUDY_ALLOWED_ORIGINS (comma-separated) restricts browser origins for these routes.
 */

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Verify an HS256 JWT; returns its `sub` or null. Pure function — exported for tests. */
export function verifyHs256(token: string, secret: string, nowSec = Math.floor(Date.now() / 1000)): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const header = JSON.parse(b64url(h).toString('utf8'));
    if (header?.alg !== 'HS256') return null; // never accept "none" or asymmetric algs here
    const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
    const given = b64url(sig);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(b64url(p).toString('utf8'));
    if (typeof payload?.exp === 'number' && payload.exp < nowSec) return null;
    if (typeof payload?.nbf === 'number' && payload.nbf > nowSec) return null;
    return isSafeId(payload?.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

export function studyAuthEnabled(): boolean {
  return !!process.env.STUDY_JWT_SECRET;
}


/** Sets c.var.studyUser to the verified user id (or undefined in open dev mode). */
export const studyAuth: MiddlewareHandler<{ Variables: { studyUser?: string } }> = async (c, next) => {
  const origins = allowedOrigins();
  const origin = c.req.header('origin');
  if (origins.length && origin && !origins.includes(origin)) return c.json({ error: 'origin not allowed' }, 403);

  const secret = process.env.STUDY_JWT_SECRET;
  if (secret) {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const sub = token ? verifyHs256(token, secret) : null;
    if (!sub) return c.json({ error: 'unauthorized' }, 401);
    c.set('studyUser', sub);
  }
  await next();
};

/** NFR1: per-user daily upload cap (in memory; resets at UTC midnight or restart). */
const uploadCounts = new Map<string, number>();
export function takeUploadSlot(user: string, now: Date = new Date()): boolean {
  const cap = Number(process.env.STUDY_DAILY_UPLOAD_CAP ?? 20);
  const key = `${now.toISOString().slice(0, 10)}|${user}`;
  const n = uploadCounts.get(key) ?? 0;
  if (Number.isFinite(cap) && n >= cap) return false;
  uploadCounts.set(key, n + 1);
  if (uploadCounts.size > 10_000) {
    const today = now.toISOString().slice(0, 10);
    for (const k of uploadCounts.keys()) if (!k.startsWith(today)) uploadCounts.delete(k);
  }
  return true;
}

/** Test helper. */
export function resetUploadCounts() { uploadCounts.clear(); }
