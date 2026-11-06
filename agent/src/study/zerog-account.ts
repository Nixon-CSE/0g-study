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
 *   - mk-…  management key → Read-only preset: GET /v1/account/balance, usage history, the key list
 * Both are kept server-side only, encrypted at rest (AES-256-GCM, key derived from STUDY_JWT_SECRET),
 * and never returned to the browser. The shared ZEROG_API_KEY is never exposed either.
 */

export interface UserKeys { apiKey: string; managementKey: string; }

export function accountsEnabled(): boolean {
  return process.env.ZEROG_USER_ACCOUNTS === 'on' && !!process.env.STUDY_JWT_SECRET;
}

/** Why students can't connect their own account right now, for the boot log; null when they can. */
export function accountsOffReason(): string | null {
  if (process.env.ZEROG_USER_ACCOUNTS !== 'on') return 'ZEROG_USER_ACCOUNTS is not "on"';
  if (!process.env.STUDY_JWT_SECRET) return 'STUDY_JWT_SECRET is not set, so keys could not be bound to a verified student or encrypted';
  return null;
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

/**
 * A student's 0G balance, exact. Measured on a real account (2026-11-06): `currency: "usd"` amounts are
 * integer micro-USD; "0g" (or absent) amounts are neuron (1e18 = 1 0G). A charge lands in
 * `unsettled_charge` within ~3 s and leaves it for `total_balance` a few seconds later, so
 * available = total − unsettled is the number that drops first. credit = bonus and daily iAI credits.
 */
export interface AccountBalance { currency: 'usd' | '0g'; available: bigint; credit: bigint; deposit: bigint; unsettled: bigint }

const amount = (v: unknown): bigint | null => (typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null);

/** Parse GET /v1/account/balance. Null when a required field is missing or invalid: never a guessed number. */
export function parseBalance(j: any): AccountBalance | null {
  const currency = String(j?.currency ?? '0g').toLowerCase();
  if (currency !== 'usd' && currency !== '0g') return null;
  const total = amount(j?.total_balance ?? j?.balance);
  const credit = amount(j?.credit_balance ?? '0');
  const deposit = amount(j?.deposit_balance ?? '0');
  const unsettled = amount(j?.unsettled_charge ?? '0');
  if (total === null || credit === null || deposit === null || unsettled === null) return null;
  return { currency, available: total > unsettled ? total - unsettled : 0n, credit, deposit, unsettled };
}

/** The browser's copy: bigints as strings. */
export function publicBalance(b: AccountBalance | null) {
  return b && { currency: b.currency, available: String(b.available), credit: String(b.credit), deposit: String(b.deposit), unsettled: String(b.unsettled) };
}

export type BalanceResult =
  | { ok: true; balance: AccountBalance | null; address: string | null }
  | { ok: false; status: number; error: string };

/** GET /v1/account/balance with the user's mk- key (scope account:read). */
export async function fetchBalance(managementKey: string, f: typeof fetch = fetch): Promise<BalanceResult> {
  try {
    const r = await f(`${routerBaseUrl()}/account/balance`, {
      headers: { authorization: `Bearer ${managementKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.code ?? j?.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, balance: parseBalance(j), address: typeof j?.address === 'string' ? j.address : null };
  } catch (e: any) {
    return { ok: false, status: 502, error: `0G unreachable: ${e?.cause?.code ?? e?.name ?? 'error'}` };
  }
}

export interface BilledCall { requestId: string; cost: string; creditUsed: string; depositUsed: string; model: string | null; at: string | null }
export type HistoryResult = { ok: true; currency: string; calls: BilledCall[] } | { ok: false; status: number; error: string };

const num = (v: unknown): string => (typeof v === 'number' || typeof v === 'string') && /^\d+(\.\d+)?$/.test(String(v)) ? String(v) : '0';

/** GET /v1/account/usage/history with the student's own mk- key: their newest calls, what each cost and how it was paid. */
export async function fetchUsageHistory(managementKey: string, limit = 100, f: typeof fetch = fetch): Promise<HistoryResult> {
  try {
    const r = await f(`${routerBaseUrl()}/account/usage/history?limit=${limit}`, {
      headers: { authorization: `Bearer ${managementKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.code ?? `HTTP ${r.status}` };
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    return {
      ok: true,
      currency: String(j?.currency ?? rows[0]?.currency ?? '0g').toLowerCase(),
      calls: rows.filter((x) => typeof x?.request_id === 'string').map((x) => ({
        requestId: x.request_id, cost: num(x.cost), creditUsed: num(x.credit_used), depositUsed: num(x.deposit_used),
        model: typeof x.model_id === 'string' ? x.model_id : null, at: typeof x.created_at === 'string' ? x.created_at : null,
      })),
    };
  } catch (e: any) {
    return { ok: false, status: 502, error: `0G unreachable: ${e?.cause?.code ?? e?.name ?? 'error'}` };
  }
}

const HISTORY_TTL_MS = 5_000;
const historyCache = new Map<string, { at: number; result: Extract<HistoryResult, { ok: true }> }>();

/** One student's history, cached for a few seconds under their own id. Failures are not cached. */
export async function cachedUsageHistory(userId: string, managementKey: string, read: typeof fetchUsageHistory = fetchUsageHistory, now = Date.now()): Promise<HistoryResult> {
  const hit = historyCache.get(userId);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.result;
  const result = await read(managementKey);
  if (result.ok) historyCache.set(userId, { at: now, result });
  if (historyCache.size > 1000) historyCache.clear();
  return result;
}
export function forgetUsageHistory(userId?: string) { if (userId) historyCache.delete(userId); else historyCache.clear(); }

export interface ApiKeyInfo { preview: string; revoked: boolean; expiresAt: string | null }
export type KeyListResult = { ok: true; keys: ApiKeyInfo[] } | { ok: false; status: number; error: string };

/** GET /v1/api-keys with the mk- key (scope keys:read): the account's keys as previews, never secrets. */
export async function fetchApiKeys(managementKey: string, f: typeof fetch = fetch): Promise<KeyListResult> {
  try {
    const r = await f(`${routerBaseUrl()}/api-keys`, {
      headers: { authorization: `Bearer ${managementKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: j?.error?.code ?? `HTTP ${r.status}` };
    const rows: any[] = Array.isArray(j?.data) ? j.data : [];
    return { ok: true, keys: rows.map((k) => ({ preview: String(k?.key_preview ?? ''), revoked: k?.revoked === true, expiresAt: typeof k?.expires_at === 'string' ? k.expires_at : null })) };
  } catch (e: any) {
    return { ok: false, status: 502, error: `0G unreachable: ${e?.cause?.code ?? e?.name ?? 'error'}` };
  }
}

/** Does a preview like `sk-abcde…` belong to this key? Previews show only the first characters. */
export function previewMatches(preview: string, key: string): boolean {
  const parts = preview.split(/…|\.\.\.|\*+/).filter(Boolean);
  if (!parts[0] || parts[0].length < 4) return false;
  return key.startsWith(parts[0]) && (parts.length < 2 || key.endsWith(parts[parts.length - 1]));
}

/** A plain-words reason a pasted key has the wrong shape, or null. */
export function keyFormatError(k: any): string | null {
  if (typeof k?.apiKey !== 'string' || !k.apiKey.startsWith('sk-')) return 'The API key should start with sk-. Copy it from pc.0g.ai → API Keys.';
  if (typeof k?.managementKey !== 'string' || !k.managementKey.startsWith('mk-')) return 'The management key should start with mk-. Copy it from pc.0g.ai → Management Keys.';
  return validKeys(k) ? null : "One of the keys looks cut off. Copy it again from pc.0g.ai; it's only shown once, so you may need a new one.";
}

const UNREACHABLE = "We couldn't reach 0G to check your keys, so nothing was saved. Try again in a moment.";
function managementKeyError(status: number): { status: number; error: string } {
  if (status === 401) return { status: 400, error: 'The management key (mk-…) was rejected: it is wrong or has been revoked. Create a new one at pc.0g.ai → Management Keys.' };
  if (status === 403) return { status: 400, error: "The management key (mk-…) can't read your account. Create one with the Read-only preset (account:read, keys:read)." };
  return { status: 502, error: UNREACHABLE };
}

export type VerifyResult = { ok: true; balance: AccountBalance | null; address: string | null } | { ok: false; status: number; error: string };

/**
 * Check both keys live before anything is stored, without spending credits: the mk- key must read the
 * balance, and the sk- key must be listed on that same account and active. The router only exposes a
 * short preview of each key, so this catches mixed-up accounts and revoked keys but is not proof of
 * the full secret: a wrong key that shares its first characters would surface on the first pod call.
 */
export async function verifyUserKeys(
  keys: UserKeys,
  deps: { balance?: typeof fetchBalance; listKeys?: typeof fetchApiKeys } = {},
  now: Date = new Date(),
): Promise<VerifyResult> {
  const b = await (deps.balance ?? fetchBalance)(keys.managementKey);
  if (!b.ok) return { ok: false, ...managementKeyError(b.status) };
  const l = await (deps.listKeys ?? fetchApiKeys)(keys.managementKey);
  if (!l.ok) return { ok: false, ...managementKeyError(l.status) };
  const mine = l.keys.filter((k) => previewMatches(k.preview, keys.apiKey));
  if (mine.length === 0) return { ok: false, status: 400, error: "This API key (sk-…) isn't on the same pc.0g.ai account as the management key. Create both on one account." };
  const active = mine.some((k) => !k.revoked && (!k.expiresAt || !(Date.parse(k.expiresAt) <= now.getTime())));
  if (!active) return { ok: false, status: 400, error: 'This API key (sk-…) has been revoked or has expired. Create a new one at pc.0g.ai → API Keys.' };
  return { ok: true, balance: b.balance, address: b.address };
}

/** Time until the daily credits refresh (00:00 UTC), e.g. "3h 14m". */
export function untilCreditReset(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const mins = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** One honest line when the student's own credits ran out. Nothing falls back to the shared key. */
export function ownCreditsOutLine(now: Date = new Date()): string {
  return `_(Your own 0G credits have run out. Daily credits refresh at 00:00 UTC, in ${untilCreditReset(now)}. To keep studying now, press disconnect in the status bar to use the free tier, or top up at pc.0g.ai.)_`;
}
