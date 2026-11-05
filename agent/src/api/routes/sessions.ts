import { Hono } from 'hono';

export interface SessionsRouteDeps {
  /** Clear the stored conversation for a session; returns the number of messages removed. */
  resetSession: (key: { channel: string; chatId: string; topic?: string }) => number;
}

export function sessionsRoutes(opts: SessionsRouteDeps) {
  const app = new Hono();

  // Clear a conversation. Body: { chatId (required), channel?="web", topic? }
  app.post('/sessions/reset', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const chatId = body?.chatId;
    if (!chatId || typeof chatId !== 'string') {
      return c.json({ ok: false, error: 'chatId required' }, 400);
    }
    const channel = typeof body?.channel === 'string' ? body.channel : 'web';
    const topic = typeof body?.topic === 'string' ? body.topic : undefined;
    const cleared = opts.resetSession({ channel, chatId, topic });
    return c.json({ ok: true, cleared });
  });

  return app;
}
