// Markers embedded in message text (a pragmatic transport for the hackathon; see prd.md G6):
//   ⟦0g:<id>,<id>⟧   0G Private Computer request ids, appended by the agent runtime
//   [[upload:<id>]]  notes photo attached by the student

const ZG_RE = /\n*⟦0g:([^⟧]*)⟧/g;
const UPLOAD_RE = /\s*\[\[upload:([A-Za-z0-9-]+)\]\]/g;

export interface ParsedMarkers {
  /** Message text with all markers removed. */
  text: string;
  requestIds: string[];
  uploadIds: string[];
}

// The runtime appends exactly one marker at the very end of a reply. Only that one is proof;
// a marker anywhere else (echoed by the model, typed by a user) is stripped but never trusted.
const TRAILING_ZG_RE = /⟦0g:([^⟧]*)⟧\s*$/;
const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function parseMarkers(content: string): ParsedMarkers {
  const requestIds: string[] = [];
  const uploadIds: string[] = [];
  const trailing = (content ?? "").match(TRAILING_ZG_RE);
  if (trailing) {
    const ids = trailing[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0 && ids.length <= 20 && ids.every((id) => REQUEST_ID_RE.test(id))) requestIds.push(...ids);
  }
  const text = (content ?? "")
    .replace(ZG_RE, "")
    .replace(UPLOAD_RE, (_m, id: string) => { uploadIds.push(id); return ""; })
    .trim();
  return { text, requestIds, uploadIds };
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
