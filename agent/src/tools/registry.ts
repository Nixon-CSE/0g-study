import type { Tool } from 'ai';
import type { AgentConfig } from '../config/schema.js';
import { webFetchTool } from './builtin/web-fetch.js';
import { makeWebSearchTool } from './builtin/web-search.js';
import { makeCodeExecTool } from './builtin/code-exec.js';
import { makeFileOpsTools } from './builtin/file-ops.js';
import { publishSiteTool } from './builtin/publish-site.js';
import { currentTimeTool } from './builtin/current-time.js';
import { makeStudyTools } from './builtin/study.js';
import type { McpHandle } from './mcp-client.js';

export function buildToolRegistry(cfg: AgentConfig, mcpHandles: McpHandle[], agentDir: string = process.cwd()): Record<string, Tool> {
  const tools: Record<string, Tool> = {};
  const b = cfg.tools.builtin;
  if (b.webFetch.enabled) tools.web_fetch = webFetchTool;
  if (b.webSearch.enabled) {
    const k = process.env[b.webSearch.apiKeyEnv];
    if (k) tools.web_search = makeWebSearchTool(b.webSearch.provider, k);
  }
  if (b.codeExec.enabled) tools.code_exec = makeCodeExecTool(b.codeExec.timeoutMs);
  if (b.fileOps.enabled) Object.assign(tools, makeFileOpsTools(b.fileOps.rootDir));
  if (b.publishSite.enabled) tools.publish_site = publishSiteTool;
  if (b.currentTime.enabled) tools.current_time = currentTimeTool;
  if (b.studyTools.enabled) Object.assign(tools, makeStudyTools(agentDir));
  for (const h of mcpHandles) Object.assign(tools, h.tools);
  return tools;
}
