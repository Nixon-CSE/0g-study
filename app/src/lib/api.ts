import { BONFIRE_BASE_URL } from '@/lib/config';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** When false, the Authorization header is not sent. Defaults to true. */
  auth?: boolean;
}

/**
 * Module-level token provider. Defaults to returning null (no auth).
 *
 * AuthProvider calls setAccessTokenProvider() in a useEffect to wire in
 * Privy's getAccessToken() so every api() call attaches the correct header
 * without coupling this module to React hooks or localStorage.
 */
let tokenProvider: () => Promise<string | null> = async () => null;

/**
 * Replace the active token provider.
 *
 * Called once by AuthProvider on mount (and whenever auth state changes) to
 * inject Privy's getAccessToken function.
 *
 * @param fn - async function that resolves to the current access token or null
 */
export function setAccessTokenProvider(fn: () => Promise<string | null>): void {
  tokenProvider = fn;
}

/**
 * Resolve the current access token via the registered provider. Returns null
 * when no provider is wired or when the user is unauthenticated. Use this
 * from code paths that need the bearer token directly (e.g. multipart
 * uploads where api() is not applicable).
 */
export async function getAccessToken(): Promise<string | null> {
  return await tokenProvider();
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: ApiOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const useAuth = opts.auth !== false;
  if (useAuth) {
    const tok = await tokenProvider();
    if (tok) headers['authorization'] = `Bearer ${tok}`;
  }

  const res = await fetch(`${BONFIRE_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && data !== null && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, data, msg);
  }

  return data as T;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
