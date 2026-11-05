import { z } from 'zod';

export const LlmConfigSchema = z.object({
  provider: z.enum(['openai-compatible', 'zerog', 'zerog-router']).default('openai-compatible'),
  // openai-compatible: required. zerog: optional (auto-discovered via broker). zerog-router: 0G Private Computer router API (ZEROG_API_KEY).
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
  apiKeyEnv: z.string().default('LLM_API_KEY'),
  // 0G-specific (with env-var fallbacks for backwards compat)
  rpcUrlEnv: z.string().default('OG_RPC_URL'),
  privateKeyEnv: z.string().default('DEPLOYER_PRIVATE_KEY'),
  preferredProviderEnv: z.string().default('OG_BROKER_PROVIDER'),
  temperature: z.number().default(0.7),
  maxTokens: z.number().default(4096),
});

export const EmbeddingsConfigSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string(),
  apiKeyEnv: z.string().default('EMBEDDINGS_API_KEY'),
}).optional();

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tokenEnv: z.string().default('TELEGRAM_BOT_TOKEN'),
  dmPolicy: z.enum(['open', 'allowlist', 'pairing', 'disabled']).default('open'),
  allowFrom: z.array(z.string()).default([]),
  groups: z.record(z.object({
    requireMention: z.boolean().default(true),
    allowFrom: z.array(z.string()).default([]),
  })).default({}),
});

export const WebChatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default('/chat'),
});

export const ChannelsSchema = z.object({
  telegram: TelegramConfigSchema.default(() => ({}) as any),
  web: WebChatConfigSchema.default(() => ({}) as any),
});

export const EvolutionSchema = z.object({
  mode: z.enum(['off', 'suggest', 'auto-safe', 'auto-all']).default('suggest'),
  intervalHours: z.number().default(24),
  registries: z.array(z.string()).default(['agentskill.sh']),
  interests: z.array(z.string()).default([]),
  controlChannel: z.string().optional(),
});

export const MemorySchema = z.object({
  maxSessions: z.number().default(100),
  compactAfterTokens: z.number().default(8000),
  vectorStorePath: z.string().default('./memory/store.json'),
});

export const BuiltinToolsSchema = z.object({
  webSearch: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(['tavily', 'brave']).default('tavily'),
    apiKeyEnv: z.string().default('TAVILY_API_KEY'),
  }).default(() => ({}) as any),
  webFetch: z.object({ enabled: z.boolean().default(true) }).default(() => ({}) as any),
  codeExec: z.object({ enabled: z.boolean().default(false), timeoutMs: z.number().default(5000) }).default(() => ({}) as any),
  fileOps: z.object({ enabled: z.boolean().default(false), rootDir: z.string().default('./workspace') }).default(() => ({}) as any),
  publishSite: z.object({ enabled: z.boolean().default(true) }).default(() => ({}) as any),
  currentTime: z.object({ enabled: z.boolean().default(true) }).default(() => ({}) as any),
  studyTools: z.object({ enabled: z.boolean().default(false) }).default(() => ({}) as any),
});

export const ToolsSchema = z.object({ builtin: BuiltinToolsSchema.default(() => ({}) as any) }).default(() => ({}) as any);

export const McpSchema = z.object({ configFile: z.string().default('./mcp.json') }).default(() => ({}) as any);

export const LoggingSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  logDir: z.string().default('./logs'),
}).default(() => ({}) as any);

export const AgentConfigSchema = z.object({
  name: z.string(),
  id: z.string().regex(/^[a-z0-9-]+$/),
  llm: LlmConfigSchema,
  embeddings: EmbeddingsConfigSchema,
  channels: ChannelsSchema.default(() => ({}) as any),
  mcp: McpSchema,
  evolution: EvolutionSchema.default(() => ({}) as any),
  memory: MemorySchema.default(() => ({}) as any),
  tools: ToolsSchema,
  logging: LoggingSchema,
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const McpJsonSchema = z.object({
  servers: z.record(z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
    enabled: z.boolean().default(true),
  })).default(() => ({}) as any),
});
export type McpJson = z.infer<typeof McpJsonSchema>;
