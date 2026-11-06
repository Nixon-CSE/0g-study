/**
 * The agent runtime's admin routes (/tenants, /config, /mcp, /skills) require AGENT_ADMIN_TOKEN.
 * The token is attached ONLY to requests for the platform's own runtime (EMBER_AGENT_BASE_URL):
 * agents can be registered with any baseUrl, so sending it everywhere would leak it to whoever
 * registers an agent pointing at their own server.
 */
export const AGENT_ADMIN_HEADER = 'x-agent-admin-token';

export function agentAdminHeaders(url: string): Record<string, string> {
  const token = process.env.AGENT_ADMIN_TOKEN;
  if (!token) return {};
  try {
    const home = new URL(process.env.EMBER_AGENT_BASE_URL ?? 'http://localhost:7777');
    return new URL(url).origin === home.origin ? { [AGENT_ADMIN_HEADER]: token } : {};
  } catch {
    return {};
  }
}

/** fetch() for agent-runtime admin calls; identical to fetch() when no header applies. */
export function agentFetch(url: string, init?: RequestInit): Promise<Response> {
  const extra = agentAdminHeaders(url);
  if (Object.keys(extra).length === 0) return init === undefined ? fetch(url) : fetch(url, init);
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return fetch(url, { ...(init ?? {}), headers });
}

/** Public views of an agent's MCP servers must never expose env values (they hold API keys). */
export function maskMcpServers(body: unknown): unknown {
  const servers = (body as { servers?: Record<string, any> } | null)?.servers;
  if (!servers || typeof servers !== 'object') return body;
  const masked: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(servers)) {
    const env = s && typeof s.env === 'object' && s.env ? s.env : {};
    masked[id] = { ...s, env: Object.fromEntries(Object.keys(env).map((k) => [k, '***'])) };
  }
  return { ...(body as object), servers: masked };
}
