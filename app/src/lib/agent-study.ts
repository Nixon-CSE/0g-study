import { AGENT_BASE_URL } from "./config";
import { api } from "./api";

/**
 * Calls a Study Pod endpoint on the agent runtime (/uploads, /usage, /study/index).
 *
 * NFR1: the agent verifies a short-lived study token issued by the backend
 * (GET /v1/auth/study-token, signed with the backend JWT_SECRET; the agent has the same
 * value as STUDY_JWT_SECRET). The Privy token itself never goes to the agent.
 * If the backend is unreachable we still call the agent without a token, which works
 * only when the agent runs in open dev mode.
 */
let cached: { token: string; exp: number } | null = null;
let inflight: Promise<string | null> | null = null;

async function studyToken(): Promise<string | null> {
  if (cached && cached.exp - 60_000 > Date.now()) return cached.token;
  if (!inflight) {
    inflight = api<{ token: string; expiresIn: number }>("GET", "/v1/auth/study-token")
      .then((r) => {
        cached = { token: r.token, exp: Date.now() + r.expiresIn * 1000 };
        return r.token;
      })
      .catch(() => null)
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Forget the cached token (call on logout). */
export function clearStudyToken() { cached = null; }

export async function agentStudyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const tok = await studyToken();
  if (tok) headers.set("authorization", `Bearer ${tok}`);
  return fetch(`${AGENT_BASE_URL}${path}`, { ...init, headers });
}
