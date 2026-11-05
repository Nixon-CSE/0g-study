import { serve } from '@hono/node-server';
import { loadEnv } from './config/env.js';
import { connectDb } from './db/client.js';
import { createIndexes } from './db/indexes.js';
import { buildApp } from './api/server.js';
import { log } from './util/logger.js';
import { createInftChain } from './chain/inft.js';
import { createChainIndexer } from './chain/indexer.js';
import { createOgStorage } from './storage-0g/index.js';
import type { InftDeps } from './agents/invoker.js';
import { attachSignalingServer } from './voice/signaling.js';
import { createDailyClient, VoiceManager, defaultBotSpawner } from './voice/index.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function useDevMemoryMongo(raw: string | undefined): boolean {
  if (!raw) return false;
  return ['1', 'true', 'yes'].includes(raw.trim().toLowerCase());
}

async function main() {
  const env = loadEnv();
  let mongoUri = env.MONGODB_URI;

  let stopMemoryMongo: (() => Promise<void>) | undefined;
  if (useDevMemoryMongo(env.DEV_MEMORY_MONGO)) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const memoryServer = await MongoMemoryServer.create();
    mongoUri = memoryServer.getUri();
    stopMemoryMongo = async () => {
      await memoryServer.stop();
    };
    log.warn({ uri: mongoUri.replace(/mongodb:\/\/[^:]+:[^@]+@/, 'mongodb://***@') }, 'DEV_MEMORY_MONGO enabled (ephemeral DB, data lost on exit)');
  }

  const { db, close: closeDbClient } = await connectDb({
    ...env,
    MONGODB_URI: mongoUri,
  });
  const closeDb = async () => {
    await closeDbClient();
    if (stopMemoryMongo) await stopMemoryMongo();
  };
  await createIndexes(db);
  log.info({ db: env.MONGODB_DB }, 'mongo connected');

  // Wire INFT integration when all three env vars are present.
  let inftDeps: InftDeps | undefined;
  let stopIndexer: (() => Promise<void>) | undefined;
  if (env.INFT_CONTRACT_ADDRESS && env.PLATFORM_EXECUTOR_PRIVATE_KEY) {
    const inft = createInftChain({ rpcUrl: env.OG_RPC_URL, contractAddress: env.INFT_CONTRACT_ADDRESS });
    const storage = createOgStorage();
    inftDeps = { inft, storage, platformExecutorPrivkey: env.PLATFORM_EXECUTOR_PRIVATE_KEY };
    const indexer = createChainIndexer({ db, inft, contractAddress: env.INFT_CONTRACT_ADDRESS, rpcUrl: env.OG_RPC_URL });
    await indexer.start();
    stopIndexer = () => indexer.stop();
    log.info({ contract: env.INFT_CONTRACT_ADDRESS }, 'INFT integration enabled');
  } else {
    log.warn('INFT integration disabled — set INFT_CONTRACT_ADDRESS + PLATFORM_EXECUTOR_PRIVATE_KEY to enable');
  }

  const privyIncomplete = !(env.PRIVY_APP_ID?.trim() && env.PRIVY_APP_SECRET?.trim());
  if (privyIncomplete) {
    log.warn(
      'Privy server keys missing — set PRIVY_APP_ID and PRIVY_APP_SECRET in backend/.env (Privy Dashboard). Must match NEXT_PUBLIC_PRIVY_APP_ID.',
    );
  }

  const corsExtra = env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);

  // Wire Daily.co voice manager when DAILY_API_KEY is present.
  let voiceManager: VoiceManager | undefined;
  let stopVoiceSweeper: (() => void) | undefined;
  if (env.DAILY_API_KEY) {
    const daily = createDailyClient();
    const __dir = dirname(fileURLToPath(import.meta.url));
    // Resolve the repo root: src/index.ts → ../../.. → repo root
    const repoRoot = resolve(__dir, '..', '..');
    const spawnBot = defaultBotSpawner({
      workerCmd: env.VOICE_BOT_PYTHON,
      workerScript: resolve(repoRoot, 'backend', 'voice-worker', 'pipecat-bot.py'),
      cwd: repoRoot,
    });
    voiceManager = new VoiceManager({
      db,
      daily,
      storage: inftDeps?.storage,
      platformExecutorPrivkey: inftDeps?.platformExecutorPrivkey,
      spawnBot,
    });
    const sweepInterval = setInterval(() => {
      voiceManager!.sweep().catch((e) => log.warn({ err: e }, 'voice sweeper error'));
    }, 30_000);
    sweepInterval.unref();
    stopVoiceSweeper = () => clearInterval(sweepInterval);
    log.info('voice channels enabled (Daily.co)');
  } else {
    log.warn('voice channels disabled — set DAILY_API_KEY to enable');
  }

  const app = buildApp({
    db,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    inftDeps,
    corsOrigins: corsExtra?.length ? corsExtra : undefined,
    voiceManager,
  });
  const server = serve({ fetch: app.fetch, port: env.PORT });
  // Attach WebRTC signaling server on the same port at ws://host/voice
  attachSignalingServer(server as unknown as import('http').Server);
  log.info({ port: env.PORT }, 'ready (voice signaling on ws://localhost:' + env.PORT + '/voice)');

  const shutdown = async () => {
    log.info('shutting down');
    stopVoiceSweeper?.();
    if (voiceManager) await voiceManager.shutdown();
    server.close();
    if (stopIndexer) await stopIndexer();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { log.error({ err: e }, 'fatal'); process.exit(1); });
