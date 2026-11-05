import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSafeId } from './store.js';
import { routerBaseUrl } from '../providers/zerog-router.js';

/**
 * FR9 — "Connect your 0G account" (feature flag ZEROG_USER_ACCOUNTS=on).
 *
 * The 0G Router has no OAuth flow (docs: Router → Authentication). The documented way for a user
 * to bring their own account is their own keys:
 *   - sk-…  API key        → inference, billed against the user's own 0G deposit
 *   - mk-…  management key → with scope account:read, GET /v1/account/balance
 * Both are kept server-side only, encrypted at rest (AES-256-GCM, key derived from STUDY_JWT_SECRET),
 * and never returned to the browser. The shared ZEROG_API_KEY is never exposed either.
 */

export const NEURON_PER_0G = 10n ** 18n;

export interface UserKeys { apiKey: string; managementKey: string; }

export function accountsEnabled(): boolean {
  return process.env.ZEROG_USER_ACCOUNTS === 'on' && !!process.env.STUDY_JWT_SECRET;
}

export function validKeys(k: unknown): k is UserKeys {
  const o = k as Partial<UserKeys> | null;
  return !!o
    && typeof o.apiKey === 'string' && /^sk-[A-Za-z0-9_-]{8,200}$/.test(o.apiKey)
    && typeof o.managementKey === 'string' && /^mk-[A-Za-z0-9_-]{8,200}$/.test(o.managementKey);
}

function encKey(): Buffer {
  const secret = process.env.STUDY_JWT_SECRET;
  if (!secret) throw new Error('STUDY_JWT_SECRET is required to store 0G keys');
  return crypto.createHash('sha256').update(`0g-study-user-keys:${secret}`).digest();
}

export function sealKeys(keys: UserKeys): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(keys), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function openKeys(blob: string): UserKeys | null {
  try {
    const raw = Buffer.from(blob, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const keys = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    return validKeys(keys) ? keys : null;
  } catch {
    return null;
  }
}

function keyFile(agentDir: string, userId: string): string {
  if (!isSafeId(userId)) throw new Error('invalid user id');
  return path.join(agentDir, 'study', userId, 'zerog-keys.enc');
}

export async function saveUserKeys(agentDir: string, userId: string, keys: UserKeys): Promise<void> {
  const f = keyFile(agentDir, userId);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, sealKeys(keys), { mode: 0o600 });
}

export async function loadUserKeys(agentDir: string, userId: string): Promise<UserKeys | null> {
  if (!accountsEnabled() || !isSafeId(userId)) return null;
  try { return openKeys(await fs.readFile(keyFile(agentDir, userId), 'utf8')); } catch { return null; }
}

export async function deleteUserKeys(agentDir: string, userId: string): Promise<void> {
  await fs.rm(keyFile(agentDir, userId), { force: true });
}

/** neuron string → 0G number (display only). */
export function neuronTo0G(neuron: string): number {
  const n = BigInt(neuron);
  return Number(n / 10n ** 12n) / 1e6; // 6 decimals is plenty for a status bar
}

export type BalanceResult = { ok: true; balance0G: number } | { ok: false; status: number; error: string };

/** GET /v1/account/balance with the user's mk- key (scope account:read). */
export async function fetchBalance(managementKey: string, f: typeof fetch = fetch): Promise<BalanceResult> {
  try {
    const r = await f(`${routerBaseUrl()}/account/balance`, {
      headers: { authorization: `Bearer ${managementKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.code ?? j?.error?.message ?? `HTTP ${r.status}` };
    if (typeof j?.total_balance !== 'string' || !/^\d+$/.test(j.total_balance)) return { ok: false, status: 502, error: 'unexpected balance response' };
    return { ok: true, balance0G: neuronTo0G(j.total_balance) };
  } catch (e: any) {
    return { ok: false, status: 502, error: `0G unreachable: ${e?.cause?.code ?? e?.name ?? 'error'}` };
  }
}
