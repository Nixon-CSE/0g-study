import { Hono } from 'hono';
import { TelegramConfigSchema } from '../../config/schema.js';

export function channelRoutes(opts: { patchTelegram: (p: any) => Promise<void> }) {
  const app = new Hono();
  app.post('/channels/telegram', async (c) => {
    const body = await c.req.json();
    // Accept a partial telegram config; reject unknown/invalid values before patching.
    const parsed = TelegramConfigSchema.partial().safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    await opts.patchTelegram(parsed.data);
    return c.json({ ok: true });
  });
  return app;
}
