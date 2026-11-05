import type { Context, Next, MiddlewareHandler } from 'hono';
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';
import { verifyPrivyToken, PrivyEnvError } from './privy.js';
import { collections } from '../db/types.js';
import type { UserDoc } from '../db/types.js';
import { log } from '../util/logger.js';

export interface AuthBindings {
  Variables: {
    user: UserDoc;
  };
}

/**
 * Hono middleware that verifies a Privy access token from the Authorization
 * header, then upserts the corresponding UserDoc into MongoDB.
 *
 * On success: attaches the UserDoc to the Hono context as `user`.
 * On failure: returns 401 JSON { error: 'unauthorized' }.
 *
 * @param db - Mongo Db instance
 */
export function requireUser(db: Db, _jwtSecret?: string): MiddlewareHandler<AuthBindings> {
  return async (c: Context, next: Next) => {
    const auth = c.req.header('authorization');
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    // Slice off "Bearer " prefix — never log raw token value.
    const token = auth.slice(7).trim();
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let claims;
    try {
      claims = await verifyPrivyToken(token);
    } catch (e) {
      if (e instanceof PrivyEnvError) {
        log.error({ msg: e.message }, 'Privy server env misconfigured — protected routes cannot verify tokens');
        return c.json({ error: 'privy_server_misconfigured', message: e.message }, 503);
      }
      return c.json({ error: 'unauthorized' }, 401);
    }

    const { privyDid, walletAddress, email } = claims;

    // Derive a humane username + displayName. Prefer the email local-part
    // (e.g. "philosanjay5@gmail.com" → "philosanjay5") and fall back to the
    // Privy DID stripped down only when no email is available.
    const emailLocal = email ? email.split('@')[0]?.trim().toLowerCase() : '';
    const safeFromEmail = emailLocal
      ? emailLocal.replace(/[^a-z0-9._-]/g, '').slice(0, 32)
      : '';
    const safeFromDid = privyDid.replace(/[^a-z0-9_-]/gi, '').slice(0, 32).toLowerCase();
    const defaultUsername = safeFromEmail || safeFromDid || 'user';
    const defaultDisplayName = emailLocal || email || privyDid.slice(0, 20);

    // Upsert UserDoc: insert on first login, update wallet/email on subsequent calls.
    // Uses findOneAndUpdate with upsert so the operation is atomic.
    const now = new Date();
    const result = await db.collection<UserDoc>(collections.users).findOneAndUpdate(
      { privyDid },
      {
        $set: {
          walletAddress: walletAddress ?? null,
          email: email ?? null,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          privyDid,
          passwordHash: null,
          username: defaultUsername,
          displayName: defaultDisplayName,
          avatarUrl: null,
          bio: null,
          isService: false,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    if (!result) {
      log.error({ privyDid }, 'upsert returned null after privy token verification');
      return c.json({ error: 'unauthorized' }, 401);
    }

    c.set('user', result as UserDoc);
    await next();
  };
}
