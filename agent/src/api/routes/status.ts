import { Hono } from 'hono';
import type { AgentConfig } from '../../config/schema.js';
import type { SkillRecord } from '../../skills/loader.js';

export interface StatusRouteDeps {
  getConfig: () => AgentConfig;
  listSkills: () => SkillRecord[];
  evolutionMode: () => 'off' | 'suggest' | 'auto-safe' | 'auto-all';
  memoryStats: () => { sessions: number; messages: number; vectors: number };
}

/** Rich, read-only status for monitoring / the wrapping product (BonFire). */
export function statusRoutes(opts: StatusRouteDeps) {
  const app = new Hono();

  app.get('/status', (c) => {
    const cfg = opts.getConfig();
    const skills = opts.listSkills();
    return c.json({
      ok: true,
      name: cfg.name,
      id: cfg.id,
      uptime: process.uptime(),
      llm: { provider: cfg.llm.provider, model: cfg.llm.model ?? null },
      channels: {
        web: cfg.channels.web.enabled,
        telegram: cfg.channels.telegram.enabled,
      },
      evolution: opts.evolutionMode(),
      skills: { count: skills.length, names: skills.map((s) => s.name) },
      memory: opts.memoryStats(),
    });
  });

  return app;
}
