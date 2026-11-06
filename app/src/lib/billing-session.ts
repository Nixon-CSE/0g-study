import { parseMarkers } from "./study-markers";

/**
 * Request ids of the pod replies received in this browser tab, for the status bar's session line.
 * Only ids: what they cost is read from the student's own usage history. Storage can be unavailable,
 * in which case the session simply lasts until the page reloads.
 */
const KEY = "0g-session-request-ids";
const MAX_IDS = 100; // what one billing request can match
export const POD_REPLY_EVENT = "zerog:pod-reply";

let memory: string[] = [];

export function sessionIds(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) { const ids = JSON.parse(raw); if (Array.isArray(ids)) return ids.filter((x) => typeof x === "string"); }
  } catch { /* fall back to memory */ }
  return memory;
}

export function rememberIds(ids: string[]): string[] {
  const all = [...new Set([...sessionIds(), ...ids])].slice(-MAX_IDS);
  memory = all;
  try { sessionStorage.setItem(KEY, JSON.stringify(all)); } catch { /* memory only */ }
  return all;
}

export function clearSessionIds() {
  memory = [];
  try { sessionStorage.removeItem(KEY); } catch { /* nothing stored */ }
}

/** Call with the agent replies just received: remembers their ids and tells the status bar to re-read. */
export function notePodReplies(contents: (string | null | undefined)[]) {
  const ids = contents.flatMap((c) => parseMarkers(c ?? "").requestIds);
  if (ids.length === 0) return;
  rememberIds(ids);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(POD_REPLY_EVENT));
}
