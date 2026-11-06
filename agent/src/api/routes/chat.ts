import { isSafeId } from '../../study/store.js';
import { ADMIN_HEADER, tokenMatches } from '../admin-auth.js';
import { log } from '../../util/logger.js';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { WebChatAdapter } from '../../channels/web.js';
import type { TenantPayload } from '../../channels/base.js';

/** Zod schema for an inline decrypted tenant bundle.
 * Only the fields the runtime needs are required; metadata fields (avatarUrl, tags, etc.)
 * live in the public manifest and are not needed at inference time.
 */
const TenantPayloadSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  name: z.string().min(1).max(64),
  soul: z.string(),
  agents: z.string(),
  llm: z.object({
    provider: z.enum(['openai-compatible', 'zerog', 'zerog-router']).optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    apiKeyEnv: z.string().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
  }).default({}),
});

/**
 * `studentId` selects whose study data (streak, flashcards, past notes) a turn may read and write, so it
 * must not be forgeable from a public endpoint. It is honoured only when:
 *   - AGENT_ADMIN_TOKEN is set (any deployment) and the request carries it: the BonFire backend,
 *     which got the id from the signed-in user; or
 *   - no admin token is configured (local dev) and the request is not a cross-origin browser call
 *     (same rule as admin-auth, so a web page cannot impersonate a student on localhost).
 * Otherwise the id is dropped and the turn runs with no student (study tools return ok:false).
 */
export function trustedStudentId(
  raw: unknown,
  req: { adminToken?: string; origin?: string; selfOrigin: string },
): string | undefined {
  if (!isSafeId(raw)) return undefined;
  const token = process.env.AGENT_ADMIN_TOKEN;
  if (token) return tokenMatches(req.adminToken, token) ? raw : undefined;
  if (req.origin && req.origin !== req.selfOrigin) return undefined;
  return raw;
}

export function chatRoutes(web: WebChatAdapter, publicDir: string) {
  const app = new Hono();

  app.get('/chat', (c) => {
    const html = fs.readFileSync(path.join(publicDir, 'chat.html'), 'utf8');
    return c.html(html);
  });

  app.post('/chat/message', async (c) => {
    const body = await c.req.json();
    const { userId = 'anonymous', text, envOverride } = body;
    if (!text) return c.json({ error: 'text required' }, 400);

    // Resolve tenant: object → inline payload (validated), string → legacy slug lookup.
    let tenantSlug: string | undefined;
    let tenantInline: TenantPayload | undefined;
    if (body.tenant !== undefined && body.tenant !== null) {
      if (typeof body.tenant === 'string') {
        tenantSlug = body.tenant;
      } else {
        const parsed = TenantPayloadSchema.safeParse(body.tenant);
        if (!parsed.success) {
          return c.json({ error: 'invalid tenant payload', details: parsed.error.issues }, 400);
        }
        tenantInline = parsed.data as TenantPayload;
      }
    }

    const studentId = trustedStudentId(body.studentId, {
      adminToken: c.req.header(ADMIN_HEADER),
      origin: c.req.header('origin'),
      selfOrigin: new URL(c.req.url).origin,
    });
    if (body.studentId !== undefined && !studentId) log.warn('chat/message: untrusted studentId dropped');
    const streamId = await web.enqueue(userId, text, tenantSlug, envOverride ?? undefined, tenantInline, studentId);
    return c.json({ streamId });
  });

  app.get('/chat/stream/:id', (c) => {
    const id = c.req.param('id');
    return stream(c, async (s) => {
      let unsub = () => {};
      await new Promise<void>((resolve) => {
        unsub = web.subscribe(id, (chunk, done) => {
          s.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          if (done) { s.write(`event: done\ndata: {}\n\n`); unsub(); resolve(); }
        });
        c.req.raw.signal.addEventListener('abort', () => { unsub(); resolve(); });
      });
    });
  });

  app.use('/chat-assets/*', serveStatic({ root: publicDir }));
  return app;
}
