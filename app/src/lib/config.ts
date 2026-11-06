export const BONFIRE_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BONFIRE_BASE_URL) ||
  'http://localhost:8080';

export const AGENT_BASE_URL =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_AGENT_BASE_URL) ||
  'http://localhost:7777';

/**
 * An agent's URL as a browser can reach it. The backend may hold a private host for our own runtime
 * (Railway's *.railway.internal), which only exists inside that network: use the public URL instead.
 */
export function browserAgentUrl(baseUrl: string, publicUrl: string = AGENT_BASE_URL): string {
  try {
    return new URL(baseUrl).hostname.endsWith('.railway.internal') ? publicUrl : baseUrl;
  } catch {
    return baseUrl;
  }
}
