import 'dotenv/config';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadAgent } from './config/loader.js';
import { createChatModel, createEmbeddingModel } from './runtime/llm-client.js';
import { MemoryStore } from './memory/store.js';
import { assertInside } from './util/paths.js';
import { loadSkills, watchSkills } from './skills/loader.js';
import { startMcpServers, type McpHandle } from './tools/mcp-client.js';
import { buildToolRegistry } from './tools/registry.js';
import { AgentRuntime } from './runtime/agent.js';
import { WebChatAdapter } from './channels/web.js';
import { TelegramAdapter, type TelegramOps } from './channels/telegram.js';
import { installSkill, removeSkill } from './skills/installer.js';
import { startApi } from './api/server.js';
import { ensureLearnSkill } from './skills/bootstrap.js';
import { startEvolutionLoop } from './evolution/loop.js';
import { TenantRegistry } from './tenants/registry.js';
import { log } from './util/logger.js';
import { purgeOldUploads } from './study/uploads.js';
import { drainAllPending } from './rag/notes.js';
import { accountsOffReason } from './study/zerog-account.js';
import { assertProductionEnv } from './config/production.js';
import { studyAuthEnabled } from './study/auth.js';

async function main() {
  assertProductionEnv();
  const agentDirArg = process.argv[2] ?? process.env.AGENT_DIR ?? './examples/default-agent';
  const agentDir = path.resolve(agentDirArg);
  log.info({ agentDir }, 'boot');

  const loaded = await loadAgent(agentDir);
  if (!studyAuthEnabled()) {
    log.warn('STUDY_JWT_SECRET is not set: /uploads, /usage and /study/index are unauthenticated (local dev only)');
  }

  // Initialize tenant registry — data/ lives next to the package root (one level up from src/ or dist/)
  const here = path.dirname(fileURLToPath(import.meta.url));
  // TENANTS_FILE puts it on the volume in production (see docker/entrypoint.sh).
  const tenantsFile = process.env.TENANTS_FILE ? path.resolve(process.env.TENANTS_FILE) : path.resolve(here, '..', 'data', 'tenants.json');
  const tenantRegistry = new TenantRegistry(tenantsFile);
  await tenantRegistry.load();
  const stopTenantWatcher = tenantRegistry.watch();

  await ensureLearnSkill(agentDir);

  let skills = await loadSkills(agentDir);
  const reloadSkills = async () => { skills = await loadSkills(agentDir); log.info({ count: skills.length }, 'skills reloaded'); };
  const stopWatcher = watchSkills(agentDir, () => { reloadSkills(); });

  let mcpHandles: McpHandle[] = await startMcpServers(loaded.mcp);
  const restartMcp = async () => {
    for (const h of mcpHandles) await h.close();
    mcpHandles = await startMcpServers(loaded.mcp);
  };

  const chatHandle = await createChatModel(loaded.config);
  const model = chatHandle.model;
  log.info(chatHandle.info, 'llm: chat model ready');
  const embedModel = createEmbeddingModel(loaded.config);

  const storePath = assertInside(agentDir, loaded.config.memory.vectorStorePath);
  const store = new MemoryStore(storePath);
  const bus = new EventEmitter();

  const runtime = new AgentRuntime({
    loaded, model, embedModel, store,
    getSkills: () => skills,
    getTools: () => buildToolRegistry(loaded.config, mcpHandles, loaded.dir),
    tenantRegistry,
  });

  const web = new WebChatAdapter();
  await web.start((m) => runtime.handle(m));

  const telegramOps: TelegramOps = {
    status: () => `${loaded.config.name} online · model ${chatHandle.info.model ?? 'n/a'} (${chatHandle.info.provider}) · ${skills.length} skills · up ${Math.round(process.uptime() / 60)} min`,
    listSkills: () => skills.map((s) => ({ name: s.name, description: s.description })),
    soul: () => loaded.soul,
    resetSession: (chatId) => runtime.resetSession({ channel: 'telegram', chatId }),
    installSkill: async (slug) => {
      const r = await installSkill(agentDir, 'agentskill.sh', { slug }, loaded.config.evolution.mode);
      if (r.ok) await reloadSkills();
      return { ok: r.ok, reason: r.reason };
    },
    removeSkill: async (name) => { const ok = await removeSkill(agentDir, name); if (ok) await reloadSkills(); return ok; },
  };
  const telegram = new TelegramAdapter(loaded.config, telegramOps);
  telegram.start((m) => runtime.handle(m)).catch((e) => log.error({ err: e }, 'telegram start failed'));

  const port = Number(process.env.AGENT_API_PORT ?? process.env.PORT ?? 7777); // PORT: set by hosts like Railway/Render
  // Resolve public/ relative to this file (works both for src/ and dist/)
  const publicDir = path.resolve(here, '..', 'public');

  const stopEvolution = startEvolutionLoop({
    cfg: loaded.config,
    agentDir,
    model,
    installedSlugs: () => skills.map(s => s.source ? `${s.source.owner}/${s.source.slug}` : s.name),
    recentWorkSummary: () => `Agent ${loaded.config.name} with skills: ${skills.map(s => s.name).join(', ')}`,
    notifySuggest: async (items) => { log.info({ items }, 'evolution suggestions'); bus.emit('event', { type: 'evolution.suggest', items }); },
    reload: reloadSkills,
  });

  const accountsOff = accountsOffReason();
  if (accountsOff) log.warn(`Connect your 0G account is off: ${accountsOff}`);

  // Notes photos are temporary: remove anything older than 24h now and hourly.
  // Study memory: notes whose indexing failed (0G embeddings down) are retried at boot and hourly.
  const purge = () => {
    purgeOldUploads(loaded.dir).then((n) => n && log.info({ removed: n }, 'purged old uploads')).catch(() => {});
    drainAllPending(loaded.dir).catch(() => {});
  };
  void purge();
  const purgeTimer = setInterval(purge, 60 * 60 * 1000);
  purgeTimer.unref();

  const server = startApi(port, {
    agentDir,
    publicDir,
    bus,
    web,
    evolutionMode: () => loaded.config.evolution.mode,
    listSkills: () => skills,
    reload: reloadSkills,
    restartMcp,
    getConfig: () => loaded.config,
    patchConfig: async (p) => { Object.assign(loaded.config, p); },
    patchTelegram: async (p) => { Object.assign(loaded.config.channels.telegram, p); await telegram.stop(); telegram.start((m) => runtime.handle(m)); },
    tenantRegistry,
    resetSession: (key) => runtime.resetSession(key),
    memoryStats: () => store.stats(),
    telegramRunning: () => telegram.running,
  });

  log.info({ port, skills: skills.length, mcp: mcpHandles.length, web: true, telegram: loaded.config.channels.telegram.enabled }, 'ready');

  const shutdown = async () => {
    log.info('SIGTERM: graceful shutdown');
    const left = await runtime.drain();
    if (left) log.warn({ left }, 'shutdown: turns still running after drain timeout');
    stopEvolution();
    stopWatcher();
    stopTenantWatcher();
    await telegram.stop();
    await web.stop();
    for (const h of mcpHandles) await h.close();
    store.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
