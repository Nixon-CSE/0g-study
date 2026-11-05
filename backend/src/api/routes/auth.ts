import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { verifyPrivyToken, PrivyEnvError } from '../../auth/privy.js';
import { requireUser, type AuthBindings } from '../../auth/middleware.js';
import { collections } from '../../db/types.js';
import type { UserDoc } from '../../db/types.js';
import { privateUser } from '../../users/service.js';
import { signToken } from '../../auth/jwt.js';
import { log } from '../../util/logger.js';

const VerifyBody = z.object({
  token: z.string().min(1),
});

const DEPRECATED_410 = {
  error: 'deprecated',
  migration: 'Use Privy login. See /v1/auth/privy/verify.',
} as const;

export interface AuthRouteDeps { db: Db; jwtSecret: string; jwtExpiresIn: string; }

export function authRoutes(deps: AuthRouteDeps) {
  const app = new Hono<AuthBindings>();

  /**
   * POST /v1/auth/privy/verify
   *
   * Accepts a raw Privy access token, verifies it, upserts the UserDoc,
   * and returns the BonFire user object.
   *
   * Body: { token: string }
   * Response 200: { user: UserDoc (private view) }
   * Response 401: { error: 'unauthorized' }
   */
  app.post('/v1/auth/privy/verify', async (c) => {
    const parsed = VerifyBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }

    // Never log the raw token — field name 'token' is in the pino redact list.
    const { token } = parsed.data;

    let claims;
    try {
      claims = await verifyPrivyToken(token);
    } catch (e) {
      if (e instanceof PrivyEnvError) {
        return c.json({ error: 'privy_server_misconfigured', message: e.message }, 503);
      }
      return c.json({ error: 'unauthorized' }, 401);
    }

    const { privyDid, walletAddress, email } = claims;
    const now = new Date();

    const walletShort = walletAddress
      ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`
      : null;
    const derivedDisplayName = email
      ? email.split('@')[0]
      : (walletShort ?? privyDid.slice(0, 20));

    const result = await deps.db.collection<UserDoc>(collections.users).findOneAndUpdate(
      { privyDid },
      {
        // Wallet + email stay in sync with Privy. Do NOT $set displayName here —
        // that would overwrite a name the user chose via PATCH /v1/auth/me on
        // every page load / verify (same pattern as requireUser middleware).
        $set: {
          walletAddress: walletAddress ?? null,
          email: email ?? null,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          privyDid,
          passwordHash: null,
          username: privyDid.replace(/[^a-z0-9_-]/gi, '').slice(0, 32).toLowerCase() || 'user',
          displayName: derivedDisplayName,
          avatarUrl: null,
          bio: null,
          isService: false,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result) {
      log.error({ privyDid }, '/v1/auth/privy/verify upsert returned null');
      return c.json({ error: 'internal_error' }, 500);
    }

    // Upgrade legacy accounts whose displayName is still a raw Privy DID.
    // Only overwrites when the stored value starts with "did:" — never touches
    // a name the user chose themselves.
    if (result.displayName?.startsWith('did:')) {
      await deps.db.collection<UserDoc>(collections.users).updateOne(
        { _id: result._id, displayName: { $regex: /^did:/ } },
        { $set: { displayName: derivedDisplayName } },
      );
      result.displayName = derivedDisplayName;
    }

    return c.json({ user: privateUser(result as UserDoc) });
  });

  /**
   * GET /v1/auth/me
   *
   * Returns the currently authenticated UserDoc.
   * Protected by Privy middleware — 401 if token missing or invalid.
   */
  app.get('/v1/auth/me', requireUser(deps.db, deps.jwtSecret), (c) => {
    return c.json({ user: privateUser(c.get('user')) });
  });

  /**
   * GET /v1/auth/study-token
   *
   * Short-lived (1h) HS256 token for the Study Pod endpoints on the agent runtime
   * (/uploads, /usage, /study/index). `sub` is the Mongo user id — the same id the
   * invoker forwards as `studentId`. The agent verifies it with STUDY_JWT_SECRET,
   * which must equal this backend's JWT_SECRET. Privy tokens never reach the agent.
   */
  app.get('/v1/auth/study-token', requireUser(deps.db, deps.jwtSecret), async (c) => {
    const user = c.get('user');
    const expiresIn = 3600;
    const token = await signToken({ sub: user._id.toHexString(), username: user.username }, deps.jwtSecret, `${expiresIn}s`);
    return c.json({ token, expiresIn });
  });

  /**
   * Legacy route — email/password registration is deprecated.
   * Returns 410 Gone to guide clients to migrate to Privy.
   */
  app.post('/v1/auth/register', (c) => {
    return c.json(DEPRECATED_410, 410);
  });

  /**
   * Legacy route — email/password login is deprecated.
   * Returns 410 Gone to guide clients to migrate to Privy.
   */
  app.post('/v1/auth/login', (c) => {
    return c.json(DEPRECATED_410, 410);
  });

  /**
   * POST /v1/auth/logout
   *
   * No-op — Privy manages sessions client-side.
   * Returns 204 No Content.
   */
  app.post('/v1/auth/logout', (c) => {
    return new Response(null, { status: 204 });
  });

  return app;
}
