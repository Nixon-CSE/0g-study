import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Db } from 'mongodb';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { serverRoutes } from './routes/servers.js';
import { agentRoutes } from './routes/agents.js';
import { channelRoutes } from './routes/channels.js';
import { messageRoutes } from './routes/messages.js';
import { internalRoutes } from './routes/internal.js';
import { cascadeRoutes } from './routes/cascade.js';
import { voiceRoutes } from './routes/voice.js';
import { auditRoutes } from './routes/audit.js';
import { siteRoutes } from './routes/sites.js';
import { knowledgeRoutes } from './routes/knowledge.js';
import { registerOgLlmProxy } from '../voice/og-llm-proxy.js';
import type { InftDeps } from '../agents/invoker.js';
import type { VoiceManager } from '../voice/manager.js';

function defaultCorsOrigins(): string[] {
  const out: string[] = [];
  for (const host of ['http://localhost', 'http://127.0.0.1']) {
    for (const port of [3000, 3001, 3002, 3003, 5173]) {
      out.push(`${host}:${port}`);
    }
  }
  return out;
}

/** Any http(s) Origin whose host is localhost or 127.0.0.1 (dev-only relax). */
function isLocalLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export interface AppDeps {
  db: Db;
  jwtSecret: string;
  jwtExpiresIn: string;
  cascadeConfig?: { maxHops?: number; maxInvocationsPerRoot?: number };
  /** Allowed CORS origins. Defaults to common localhost ports (3000–3003, 5173). */
  corsOrigins?: string[];
  /** Present when chain integration is configured (INFT_CONTRACT_ADDRESS + PLATFORM_EXECUTOR_PRIVATE_KEY). */
  inftDeps?: InftDeps;
  /** Present when DAILY_API_KEY is set and voice channels are enabled. */
  voiceManager?: VoiceManager;
}

export function buildApp(deps: AppDeps) {
  const app = new Hono();
  const allowed = deps.corsOrigins?.length ? deps.corsOrigins : defaultCorsOrigins();
  const allowSet = new Set(allowed);
  const corsRelaxLocal =
    process.env.NODE_ENV !== 'production' ||
    process.env.CORS_RELAX_LOOPBACK === '1' ||
    process.env.CORS_RELAX_LOOPBACK === 'true';

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (!origin) return allowed[0];
        if (allowSet.has(origin)) return origin;
        if (corsRelaxLocal && isLocalLoopbackOrigin(origin)) return origin;
        return allowed[0];
      },
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['content-type', 'authorization', 'x-bonfire-agent-key'],
      credentials: false,
      maxAge: 600,
    })
  );
  app.get('/health', async (c) => {
    let dbOk = true;
    try {
      await deps.db.command({ ping: 1 });
    } catch {
      dbOk = false;
    }
    const ok = dbOk;
    return c.json(
      {
        ok,
        uptimeSec: Math.round(process.uptime()),
        subsystems: {
          db: dbOk,
          inft: Boolean(deps.inftDeps),
          voice: Boolean(deps.voiceManager),
        },
      },
      ok ? 200 : 503
    );
  });
  app.route('/', authRoutes(deps));
  app.route('/', userRoutes(deps));
  app.route('/', serverRoutes(deps));
  app.route('/', agentRoutes(deps));
  app.route('/', channelRoutes(deps));
  app.route('/', messageRoutes({ db: deps.db, jwtSecret: deps.jwtSecret, cascadeConfig: deps.cascadeConfig, inftDeps: deps.inftDeps }));
  app.route('/', internalRoutes({ db: deps.db }));
  app.route('/', cascadeRoutes(deps));
  app.route('/', auditRoutes({ db: deps.db, jwtSecret: deps.jwtSecret }));
  app.route('/', knowledgeRoutes({ db: deps.db, jwtSecret: deps.jwtSecret }));
  // Static-site routes: agent-published HTML at /sites/<slug>/. Public, no auth.
  app.route('/', siteRoutes());
  if (deps.voiceManager) {
    app.route('/', voiceRoutes({ db: deps.db, jwtSecret: deps.jwtSecret, voiceManager: deps.voiceManager }));
    // OpenAI-shaped proxy that signs requests through 0G Compute. Used by the
    // Pipecat voice bot so it can do LLM via 0G the same way the text chat does.
    registerOgLlmProxy(app);
  }
  return app;
}
