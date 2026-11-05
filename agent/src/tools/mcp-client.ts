import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { log } from '../util/logger.js';
import type { McpJson } from '../config/schema.js';

export interface McpHandle { id: string; client: Client; tools: Record<string, Tool>; close(): Promise<void>; }

export async function startMcpServers(mcp: McpJson): Promise<McpHandle[]> {
  const handles: McpHandle[] = [];
  for (const [id, cfg] of Object.entries(mcp.servers)) {
    if (!cfg.enabled) continue;
    try {
      const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...process.env, ...cfg.env } as any });
      const client = new Client({ name: 'ember-agent', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
      const list = await client.listTools();
      const tools: Record<string, Tool> = {};
      for (const t of list.tools) {
        tools[`mcp_${id}_${t.name}`] = tool({
          description: t.description ?? `${id}.${t.name}`,
          parameters: z.any(),
          execute: async (args: any) => {
            const res = await client.callTool({ name: t.name, arguments: args });
            return res;
          },
        });
      }
      handles.push({ id, client, tools, close: async () => { await client.close(); } });
      log.info({ id, count: list.tools.length }, 'mcp server connected');
    } catch (e) { log.warn({ err: e, id }, 'mcp server failed'); }
  }
  return handles;
}
