// Markers embedded in message text (a pragmatic transport for the hackathon; see prd.md G6):
//   ⟦0g:<id>,<id>⟧   0G Private Computer request ids, appended by the agent runtime. An entry may add the
//                    router's x-0g-e2ee value and the model: `<id>~sealed~glm-5.3`, `<id>~~gemini-2.5-flash`
//   [[upload:<id>]]  notes photo attached by the student

const ZG_RE = /\n*⟦0g:([^⟧]*)⟧/g;
const UPLOAD_RE = /\s*\[\[upload:([A-Za-z0-9-]+)\]\]/g;

export interface ParsedMarkers {
  /** Message text with all markers removed. */
  text: string;
  requestIds: string[];
  uploadIds: string[];
  /** x-0g-e2ee value per request id, only for ids that carried one (verbatim, e.g. "sealed" / "none"). */
  e2ee: Record<string, string>;
  /** The model behind each request id, only for ids that carried one. */
  models: Record<string, string>;
}

// The runtime appends exactly one marker at the very end of a reply. Only that one is proof;
// a marker anywhere else (echoed by the model, typed by a user) is stripped but never trusted.
const TRAILING_ZG_RE = /⟦0g:([^⟧]*)⟧\s*$/;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const E2EE_RE = /^[a-z]{1,16}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,64}$/;

/** `id`, `id~e2ee`, `id~e2ee~model` or `id~~model`; anything else makes the whole marker untrusted. */
function parseEntry(entry: string): { id: string; e2ee?: string; model?: string } | null {
  const [id, e2ee, model, ...rest] = entry.split("~");
  if (rest.length > 0 || !REQUEST_ID_RE.test(id)) return null;
  if (model === undefined) {
    if (e2ee === undefined) return { id };
    return E2EE_RE.test(e2ee) ? { id, e2ee } : null;
  }
  if (!MODEL_RE.test(model) || (e2ee !== "" && !E2EE_RE.test(e2ee))) return null;
  return { id, model, ...(e2ee ? { e2ee } : {}) };
}

export function parseMarkers(content: string): ParsedMarkers {
  const requestIds: string[] = [];
  const uploadIds: string[] = [];
  const e2ee: Record<string, string> = {};
  const models: Record<string, string> = {};
  const trailing = (content ?? "").match(TRAILING_ZG_RE);
  if (trailing) {
    const entries = trailing[1].split(",").map((s) => s.trim()).filter(Boolean);
    const parsed = entries.map(parseEntry);
    if (entries.length > 0 && entries.length <= 20 && parsed.every(Boolean)) {
      for (const p of parsed as NonNullable<ReturnType<typeof parseEntry>>[]) {
        requestIds.push(p.id);
        if (p.e2ee) e2ee[p.id] = p.e2ee;
        if (p.model) models[p.id] = p.model;
      }
    }
  }
  const text = (content ?? "")
    .replace(ZG_RE, "")
    .replace(UPLOAD_RE, (_m, id: string) => { uploadIds.push(id); return ""; })
    .trim();
  return { text, requestIds, uploadIds, e2ee, models };
}

/**
 * Badge tooltip: each request id with the model that produced it and the router's own x-0g-e2ee value,
 * when known. pc.0g.ai shows TEE-provider calls as "Private"; we print the header rather than infer that.
 */
export function requestIdTooltip(ids: string[], e2ee: Record<string, string>, models: Record<string, string> = {}): string {
  const lines = ids.map((id) => {
    const notes = [models[id], e2ee[id] ? `x-0g-e2ee: ${e2ee[id]}` : null].filter(Boolean);
    return notes.length ? `${id}  (${notes.join(" · ")})` : id;
  });
  return `0G Private Computer request id${ids.length > 1 ? "s" : ""} (click to copy):\n${lines.join("\n")}`;
}

/** 0G proof ids to show for a message: only agent replies can carry proof. */
export function trustedRequestIds(parsed: ParsedMarkers, isBot: boolean | undefined): string[] {
  return isBot ? parsed.requestIds : [];
}

export function withUploadMarker(text: string, uploadId: string | null): string {
  return uploadId ? `${text.trim()} [[upload:${uploadId}]]`.trim() : text;
}

/** Short badge label: `0G · abcdef12…` plus `+N` for extra ids. */
export function badgeLabel(ids: string[]): string {
  if (ids.length === 0) return "";
  return `0G · ${ids[0].slice(0, 8)}…${ids.length > 1 ? ` +${ids.length - 1}` : ""}`;
}

// Study memory (RAG): the Tutor/Examiner cite past notes as [notes · 2026-11-05 · #2].
const NOTES_CITATION_RE = /\[notes · (\d{4}-\d{2}-\d{2}) · #\d+\]/g;

/** Days of the student's past notes cited in an agent reply (unique, in order). Only agent replies count. */
export function citedNoteDays(text: string, isBot: boolean | undefined): string[] {
  if (!isBot) return [];
  const days: string[] = [];
  for (const m of (text ?? "").matchAll(NOTES_CITATION_RE)) if (!days.includes(m[1])) days.push(m[1]);
  return days;
}
