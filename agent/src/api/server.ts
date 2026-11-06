import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { healthRoutes } from './routes/health.js';
import { skillsRoutes } from './routes/skills.js';
import { mcpRoutes } from './routes/mcp.js';
import { configRoutes } from './routes/config.js';
import { channelRoutes } from './routes/channels.js';
import { eventsRoutes } from './routes/events.js';
import { chatRoutes } from './routes/chat.js';
import { tenantsRoutes } from './routes/tenants.js';
import { sessionsRoutes } from './routes/sessions.js';
import { statusRoutes } from './routes/status.js';
import { studyRoutes } from './routes/study.js';
import { adminAuth } from './admin-auth.js';
import type { EventEmitter } from 'node:events';
import type { WebChatAdapter } from '../channels/web.js';
import type { AgentConfig } from '../config/schema.js';
import type { SkillRecord } from '../skills/loader.js';
import type { TenantRegistry } from '../tenants/registry.js';

export interface ApiDeps {
  agentDir: string;
  publicDir: string;
  bus: EventEmitter;
  web: WebChatAdapter;
  evolutionMode: () => 'off' | 'suggest' | 'auto-safe' | 'auto-all';
  listSkills: () => SkillRecord[];
  reload: () => Promise<void>;
  restartMcp: () => Promise<void>;
  getConfig: () => AgentConfig;
  patchConfig: (p: Partial<AgentConfig>) => Promise<void>;
  patchTelegram: (p: any) => Promise<void>;
  tenantRegistry: TenantRegistry;
  resetSession: (key: { channel: string; chatId: string; topic?: string }) => number;
  memoryStats: () => { sessions: number; messages: number; vectors: number };
}

/** Builds the HTTP app (exported so tests exercise the real route + middleware wiring). */
export function buildApi(d: ApiDeps) {
  const app = new Hono();
  app.use('*', cors({
    origin: (o) => o ?? '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    maxAge: 86400,
  }));
  app.use('*', adminAuth);
  app.route('/', healthRoutes());
  app.route('/', skillsRoutes({ agentDir: d.agentDir, evolutionMode: d.evolutionMode, listSkills: d.listSkills, reload: d.reload }));
  app.route('/', mcpRoutes({ agentDir: d.agentDir, restartMcp: d.restartMcp }));
  app.route('/', configRoutes({ getConfig: d.getConfig, patch: d.patchConfig }));
  app.route('/', channelRoutes({ patchTelegram: d.patchTelegram }));
  app.route('/', eventsRoutes(d.bus));
  app.route('/', chatRoutes(d.web, d.publicDir));
  app.route('/', tenantsRoutes(d.tenantRegistry));
  app.route('/', studyRoutes(d.agentDir));
  app.route('/', sessionsRoutes({ resetSession: d.resetSession }));
  app.route('/', statusRoutes({
    getConfig: d.getConfig,
    listSkills: d.listSkills,
    evolutionMode: d.evolutionMode,
    memoryStats: d.memoryStats,
  }));
  return app;
}

export function startApi(port: number, d: ApiDeps) {
  const app = buildApi(d);
  return serve({ fetch: app.fetch, port });
}
