import { Hono } from 'hono';
import { usageToday } from '../../providers/zerog-router.js';
import { isSafeId, studyStats } from '../../study/store.js';
import { saveUpload } from '../../study/uploads.js';
import { studyAuth, takeUploadSlot } from '../../study/auth.js';
import { accountsEnabled, deleteUserKeys, fetchBalance, loadUserKeys, saveUserKeys, validKeys } from '../../study/zerog-account.js';

/**
 * GET /usage (today's 0G usage) · POST /uploads (notes photo) · GET /study/index (streak + cards)
 * FR9 (ZEROG_USER_ACCOUNTS=on): GET/POST/DELETE /study/account — connect your own 0G keys, read your balance.
 * All sit behind studyAuth (NFR1): with STUDY_JWT_SECRET set they require the BonFire study token and
 * always answer for the token's user; without it (local dev) `?user=` is used and /study/account is off.
 */
export function studyRoutes(agentDir: string, deps: { balance?: typeof fetchBalance } = {}) {
  const balanceOf = deps.balance ?? fetchBalance;
  const app = new Hono<{ Variables: { studyUser?: string } }>();
  app.use('/usage', studyAuth);
  app.use('/uploads', studyAuth);
  app.use('/study/*', studyAuth);

  app.get('/usage', (c) => c.json(usageToday()));

  app.post('/uploads', async (c) => {
    const user = c.get('studyUser') ?? 'anonymous';
    if (!takeUploadSlot(user)) return c.json({ error: 'daily upload limit reached — try again tomorrow' }, 429);
    const { dataUrl } = await c.req.json().catch(() => ({}));
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
    if (!validKeys(body)) return c.json({ error: 'need apiKey (sk-…) and managementKey (mk-… with account:read)' }, 400);
    const b = await balanceOf(body.managementKey);
    if (!b.ok) {
      const hint = b.status === 401 || b.status === 403 ? ' — check the management key has the account:read scope' : '';
      return c.json({ error: `could not read your 0G balance: ${b.error}${hint}` }, 400);
    }
    await saveUserKeys(agentDir, user, { apiKey: body.apiKey, managementKey: body.managementKey });
    return c.json({ connected: true, balance0G: b.balance0G });
  });

  app.delete('/study/account', async (c) => {
    const user = accountUser(c);
    if (!user) return c.json({ error: 'not enabled' }, 403);
    await deleteUserKeys(agentDir, user);
    return c.json({ connected: false });
  });

  return app;
}
