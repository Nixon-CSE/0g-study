import { Hono } from 'hono';
import type { AgentConfig } from '../../config/schema.js';
import type { SkillRecord } from '../../skills/loader.js';

export interface StatusRouteDeps {
  getConfig: () => AgentConfig;
  listSkills: () => SkillRecord[];
  evolutionMode: () => 'off' | 'suggest' | 'auto-safe' | 'auto-all';
  memoryStats: () => { sessions: number; messages: number; vectors: number };
  /** Whether the Telegram bot is actually connected right now (not just enabled in config). */
  telegramRunning?: () => boolean;
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
      // `telegram` is true only while the bot is really connected: enabled in config but with no token,
      // a bad token or a crashed poller, it is false. `telegramEnabled` is the config flag.
      channels: {
        web: cfg.channels.web.enabled,
        telegram: opts.telegramRunning?.() ?? false,
        telegramEnabled: cfg.channels.telegram.enabled,
      },
      evolution: opts.evolutionMode(),
      skills: { count: skills.length, names: skills.map((s) => s.name) },
      memory: opts.memoryStats(),
    });
  });

  return app;
}
