import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().min(1),
  /** Dev only: ephemeral Mongo via mongodb-memory-server — no Docker/local mongod. Set to 1, true, or yes. */
  DEV_MEMORY_MONGO: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MAX_CASCADE_HOPS: z.coerce.number().int().nonnegative().default(5),
  MAX_INVOCATIONS_PER_ROOT: z.coerce.number().int().positive().default(20),
  OG_RPC_URL: z.string().url().default('https://evmrpc-testnet.0g.ai'),
  // INFT integration — all optional. When all three are present, the backend
  // wires up the chain client, 0G Storage, and chain-event indexer at boot.
  INFT_CONTRACT_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  PLATFORM_EXECUTOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  OG_STORAGE_MOCK: z.string().optional(),
  // Privy auth — required when Privy middleware is active.
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  /** Comma-separated origins; merges with sensible localhost defaults when omitted. */
  CORS_ORIGINS: z.string().optional(),
  // Voice channels — all optional. When DAILY_API_KEY is present, voice rooms are enabled.
  DAILY_API_KEY: z.string().optional(),
  DAILY_DOMAIN: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_TTS_VOICE: z.string().optional(),
  OPENAI_TTS_MODEL: z.string().optional(),
  /** Absolute path or alias for the Python interpreter used to spawn pipecat-bot.py. Defaults to python3. */
  VOICE_BOT_PYTHON: z.string().default('python3'),
  /** 0G LLM endpoint for the voice bot (passed through to the Python subprocess). */
  OG_LLM_BASE_URL: z.string().optional(),
  OG_LLM_API_KEY: z.string().optional(),
  OG_LLM_MODEL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * What production can't run without. Mongo must be real and persistent, the mock 0G Storage writes to
 * a disk that vanishes on redeploy, and without the rest the app can't sign anyone in or reach the agent.
 */
export function productionEnvProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const on = (v: string | undefined) => ['1', 'true', 'yes'].includes((v ?? '').trim().toLowerCase());
  if (!env.MONGODB_URI?.trim()) problems.push('MONGODB_URI is required');
  if (on(env.DEV_MEMORY_MONGO)) problems.push('DEV_MEMORY_MONGO must be off: the in-memory database loses everything on restart');
  if (on(env.OG_STORAGE_MOCK)) problems.push('OG_STORAGE_MOCK must be off: mock storage is for tests');
  for (const name of ['PRIVY_APP_ID', 'PRIVY_APP_SECRET', 'CORS_ORIGINS', 'EMBER_AGENT_BASE_URL']) {
    if (!env[name]?.trim()) problems.push(`${name} is required`);
  }
  if ((env.AGENT_ADMIN_TOKEN ?? '').length < 32) problems.push('AGENT_ADMIN_TOKEN is required (at least 32 characters, same as the agent)');
  return problems;
}

export function loadEnv(): Env {
  const problems = productionEnvProblems();
  if (problems.length) throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
