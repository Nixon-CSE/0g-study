import { Hono } from 'hono';
import { callsTodayFor, usageToday } from '../../providers/zerog-router.js';
import { runWithContext, type RequestContext } from '../../runtime/request-context.js';
import { recallNotes } from '../../rag/notes.js';
import { isSafeId, studyStats } from '../../study/store.js';
import { checkUpload, saveUpload } from '../../study/uploads.js';
import { studyAuth, takeUploadSlot } from '../../study/auth.js';
import { accountsEnabled, deleteUserKeys, fetchApiKeys, fetchBalance, keyFormatError, loadUserKeys, saveUserKeys, verifyUserKeys, type UserKeys } from '../../study/zerog-account.js';

/**
 * GET /usage (today's 0G usage) · POST /uploads (notes photo) · GET /study/index (streak + cards)
 * GET /study/recall?q= (search the student's own past notes; one 0G embeddings call)
 * FR9 (ZEROG_USER_ACCOUNTS=on): GET/POST/DELETE /study/account — connect your own 0G keys, read your balance.
 * All sit behind studyAuth (NFR1): with STUDY_JWT_SECRET set they require the BonFire study token and
 * always answer for the token's user; without it (local dev) `?user=` is used and /study/account is off.
 */
export function studyRoutes(agentDir: string, deps: { balance?: typeof fetchBalance; listKeys?: typeof fetchApiKeys } = {}) {
  const balanceOf = deps.balance ?? fetchBalance;
  const app = new Hono<{ Variables: { studyUser?: string } }>();
  app.use('/usage', studyAuth);
  app.use('/uploads', studyAuth);
  app.use('/study/*', studyAuth);

  // A signed-in student sees only their own calls and tokens. Open dev mode (no STUDY_JWT_SECRET, no
  // verified user) keeps the process-wide numbers.
  app.get('/usage', (c) => {
    const user = c.get('studyUser');
    return c.json(user ? usageToday(user) : usageToday());
  });

  app.post('/uploads', async (c) => {
    const user = c.get('studyUser') ?? 'anonymous';
    const { dataUrl } = await c.req.json().catch(() => ({}));
    // Validate first so rejected uploads do not burn the student's daily quota.
    const bad = checkUpload(dataUrl);
    if (bad) return c.json({ error: bad.error }, bad.status);
    if (!takeUploadSlot(user)) return c.json({ error: 'daily upload limit reached — try again tomorrow' }, 429);
    const r = await saveUpload(agentDir, dataUrl);
    return r.ok ? c.json({ id: r.id }) : c.json({ error: r.error }, r.status);
  });

  app.get('/study/index', async (c) => {
    const authed = c.get('studyUser');
    const user = authed ?? c.req.query('user');
    if (authed && c.req.query('user') && c.req.query('user') !== authed) return c.json({ error: 'forbidden' }, 403);
    if (!isSafeId(user)) return c.json({ error: 'user query param required (letters, digits, - _)' }, 400);
    return c.json(await studyStats(agentDir, user));
  });

  // Study memory (RAG): read-only search of the caller's own past notes. With a study token the
  // user is always the token's subject; ?user= for anyone else is refused.
  app.get('/study/recall', async (c) => {
    const authed = c.get('studyUser');
    const user = authed ?? c.req.query('user');
    if (authed && c.req.query('user') && c.req.query('user') !== authed) return c.json({ error: 'forbidden' }, 403);
    if (!isSafeId(user)) return c.json({ error: 'user query param required (letters, digits, - _)' }, 400);
    const q = (c.req.query('q') ?? '').trim();
    if (!q || q.length > 500) return c.json({ error: 'q required (1-500 chars)' }, 400);
    const k = Math.min(Math.max(Number(c.req.query('k') ?? 4) || 4, 1), 8);
    const ctx: RequestContext = { studentId: user, calls: [] };
    const own = await loadUserKeys(agentDir, user);
    if (own) ctx.zerogApiKey = own.apiKey;
    const cap = Number(process.env.STUDY_DAILY_CALL_CAP ?? 30);
    if (!own && Number.isFinite(cap) && callsTodayFor(user) >= cap) return c.json({ error: 'daily AI call limit reached' }, 429);
    try {
      const { hits } = await runWithContext(ctx, () => recallNotes(agentDir, user, q, { k }));
      return c.json({
        results: hits.map((h) => ({ citation: h.citation, heading: h.heading, text: h.text, score: h.score })),
        requestIds: ctx.calls.map((x) => x.requestId).filter(Boolean),
      });
    } catch {
      return c.json({ error: '0G embeddings unavailable' }, 503);
    }
  });

  // ── FR9: the student's own 0G account ────────────────────────────────────────
  // Requires a verified user (STUDY_JWT_SECRET) — keys must never be bound to an unverified ?user=.
  const accountUser = (c: any): string | null => (accountsEnabled() ? c.get('studyUser') ?? null : null);

  app.get('/study/account', async (c) => {
    const user = accountUser(c);
    if (!user) return c.json({ enabled: false, connected: false });
    const keys = await loadUserKeys(agentDir, user);
    if (!keys) return c.json({ enabled: true, connected: false });
    const b = await balanceOf(keys.managementKey);
    return c.json(b.ok
      ? { enabled: true, connected: true, balance0G: b.balance0G }
      : { enabled: true, connected: true, balance0G: null, error: b.error });
  });

  app.post('/study/account', async (c) => {
    const user = accountUser(c);
    if (!user) return c.json({ error: 'connecting a 0G account is not enabled on this server' }, 403);
    const body = await c.req.json().catch(() => null);
    const bad = keyFormatError(body);
    if (bad) return c.json({ error: bad }, 400);
    const keys: UserKeys = { apiKey: body.apiKey, managementKey: body.managementKey };
    // Nothing is stored until both keys check out live.
    const v = await verifyUserKeys(keys, { balance: balanceOf, listKeys: deps.listKeys });
    if (!v.ok) return c.json({ error: v.error }, v.status as 400 | 502);
    await saveUserKeys(agentDir, user, keys);
    return c.json({ connected: true, balance0G: v.balance0G });
  });

  app.delete('/study/account', async (c) => {
    const user = accountUser(c);
    if (!user) return c.json({ error: 'not enabled' }, 403);
    await deleteUserKeys(agentDir, user);
    return c.json({ connected: false });
  });

  return app;
}
