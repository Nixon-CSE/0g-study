import crypto from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/**
 * Guards the runtime's admin surface (MCP servers spawn processes, config, tenants hold agent souls,
 * skill installs, telegram, sessions, the event bus, knowledge-base RAG). The browser never needs these; the BonFire
 * backend and local scripts call them server-to-server.
 *
 * - AGENT_ADMIN_TOKEN set (required for any deployment): every admin request must carry
 *   `x-agent-admin-token: <token>`. Compared in constant time.
 * - Unset (local dev): requests that carry a cross-origin `Origin` header are refused, so a web page
 *   open in the developer's browser cannot drive localhost:7777 (drive-by RCE via POST /mcp/servers).
 *   Server-to-server calls (no Origin) and the runtime's own /chat page (same origin) still work.
 *
 * Public, intentionally: /health, /status, /chat*, and the Study routes (they have studyAuth).
 */
export const ADMIN_HEADER = 'x-agent-admin-token';
export const ADMIN_PREFIXES = ['/mcp', '/config', '/tenants', '/skills', '/channels', '/sessions', '/events', '/rag'] as const;

export function isAdminPath(p: string): boolean {
  const path = p.replace(/\/+$/, '') || '/';
  return ADMIN_PREFIXES.some((a) => path === a || path.startsWith(`${a}/`));
}

export function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export const adminAuth: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'OPTIONS' || !isAdminPath(c.req.path)) return next();
  const token = process.env.AGENT_ADMIN_TOKEN;
  if (token) {
    if (!tokenMatches(c.req.header(ADMIN_HEADER), token)) return c.json({ error: 'admin token required' }, 401);
    return next();
  }
  const origin = c.req.header('origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: 'cross-origin admin request blocked' }, 403);
  }
  return next();
};
