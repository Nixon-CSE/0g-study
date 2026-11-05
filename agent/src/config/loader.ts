import fs from 'node:fs/promises';
import path from 'node:path';
import { AgentConfigSchema, McpJsonSchema, type AgentConfig, type McpJson } from './schema.js';

export interface LoadedAgent {
  dir: string;
  config: AgentConfig;
  soul: string;
  agents: string;
  mcp: McpJson;
}

export async function loadAgent(dir: string): Promise<LoadedAgent> {
  const abs = path.resolve(dir);
  const cfgRaw = await fs.readFile(path.join(abs, 'agent.config.json'), 'utf8');
  const config = AgentConfigSchema.parse(JSON.parse(cfgRaw));
  const soul = await readOpt(path.join(abs, 'SOUL.md'));
  const agents = await readOpt(path.join(abs, 'AGENTS.md'));
  let mcp: McpJson = { servers: {} };
  try {
    const mcpRaw = await fs.readFile(path.join(abs, config.mcp.configFile), 'utf8');
    mcp = McpJsonSchema.parse(JSON.parse(mcpRaw));
  } catch { /* mcp.json optional */ }
  return { dir: abs, config, soul, agents, mcp };
}

async function readOpt(p: string): Promise<string> {
  try { return await fs.readFile(p, 'utf8'); } catch { return ''; }
}
