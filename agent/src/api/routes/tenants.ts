import { Hono } from 'hono';
import { TenantSchema } from '../../tenants/types.js';
import type { TenantRegistry } from '../../tenants/registry.js';

export function tenantsRoutes(registry: TenantRegistry) {
  const app = new Hono();

  app.get('/tenants', (c) => {
    return c.json({ tenants: registry.all() });
  });

  app.get('/tenants/:slug', (c) => {
    const slug = c.req.param('slug');
    const tenant = registry.get(slug);
    if (!tenant) return c.json({ error: 'not_found' }, 404);
    return c.json({ tenant });
  });

  app.post('/tenants', async (c) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    const parsed = TenantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'validation_failed', issues: parsed.error.issues }, 400);
    }
    const result = await registry.create(parsed.data);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ tenant: result.tenant }, 201);
  });

  app.patch('/tenants/:slug', async (c) => {
    const slug = c.req.param('slug');
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
    // Partial update: validate only provided fields (strip slug changes)
    const partial = TenantSchema.partial().omit({ slug: true, createdAt: true }).safeParse(body);
    if (!partial.success) {
      return c.json({ error: 'validation_failed', issues: partial.error.issues }, 400);
    }
    const updated = await registry.update(slug, partial.data);
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ tenant: updated });
  });

  app.delete('/tenants/:slug', async (c) => {
    const slug = c.req.param('slug');
    const deleted = await registry.remove(slug);
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
