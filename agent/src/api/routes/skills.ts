import { Hono } from 'hono';
import { installSkill, removeSkill } from '../../skills/installer.js';
import type { SkillRecord } from '../../skills/loader.js';
import { discover } from '../../evolution/discover.js';

export function skillsRoutes(opts: {
  agentDir: string;
  evolutionMode: () => 'off' | 'suggest' | 'auto-safe' | 'auto-all';
  listSkills: () => SkillRecord[];
  reload: () => Promise<void>;
}) {
  const app = new Hono();
  app.get('/skills', (c) => c.json({ skills: opts.listSkills().map(s => ({ name: s.name, description: s.description, source: s.source })) }));
  app.post('/skills/install', async (c) => {
    const body = await c.req.json();
    const source = (body.source ?? 'agentskill.sh') as any;
    const res = await installSkill(opts.agentDir, source, body, opts.evolutionMode());
    if (res.ok) await opts.reload();
    return c.json(res, res.ok ? 200 : 400);
  });
  app.delete('/skills/:name', async (c) => {
    const name = c.req.param('name');
    const ok = await removeSkill(opts.agentDir, name);
    if (ok) await opts.reload();
    return c.json({ ok });
  });
  app.get('/skills/discover', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ candidates: [] });
    const candidates = await discover([q]);
    return c.json({ candidates });
  });
  return app;
}
