import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { requireUser, type AuthBindings } from '../../auth/middleware.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import {
  findUserByUsername, publicUser, privateUser,
  updateUserProfile, updateUserPasswordHash,
} from '../../users/service.js';

const ProfilePatch = z.object({
  displayName: z.string().min(1).max(64).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
});

const PasswordPatch = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export interface UserRouteDeps { db: Db; jwtSecret: string; }

export function userRoutes(deps: UserRouteDeps) {
  const app = new Hono<AuthBindings>();

  app.get('/v1/users/:username', async (c) => {
    const u = await findUserByUsername(deps.db, c.req.param('username'));
    if (!u) return c.json({ error: 'not_found' }, 404);
    return c.json({ user: publicUser(u) });
  });

  app.patch('/v1/auth/me', requireUser(deps.db, deps.jwtSecret), async (c) => {
    const parsed = ProfilePatch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    const me = c.get('user');
    const updated = await updateUserProfile(deps.db, me._id, parsed.data);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ user: privateUser(updated) });
  });

  app.patch('/v1/auth/me/password', requireUser(deps.db, deps.jwtSecret), async (c) => {
    const parsed = PasswordPatch.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const me = c.get('user');
    if (!me.passwordHash || !(await verifyPassword(me.passwordHash, parsed.data.currentPassword))) {
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    const newHash = await hashPassword(parsed.data.newPassword);
    await updateUserPasswordHash(deps.db, me._id, newHash);
    return c.json({ ok: true });
  });

  return app;
}
