import { Hono } from 'hono';
import { AgentConfigSchema, type AgentConfig } from '../../config/schema.js';

export function configRoutes(opts: { getConfig: () => AgentConfig; patch: (p: Partial<AgentConfig>) => Promise<void> }) {
  const app = new Hono();
  app.get('/config', (c) => c.json(JSON.parse(JSON.stringify(opts.getConfig()))));
  app.patch('/config', async (c) => {
    const body = await c.req.json();
    const parsed = AgentConfigSchema.partial().safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);
    await opts.patch(parsed.data as Partial<AgentConfig>);
    return c.json({ ok: true });
  });
  return app;
}
