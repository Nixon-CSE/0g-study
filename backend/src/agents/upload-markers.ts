/**
 * `[[upload:<id>]]` markers in a human message (written by the app's withUploadMarker; see
 * app/src/lib/study-markers.ts). The backend forwards a cascade root's ids to the agent as
 * `excludeUploadIds`, so recall_notes never presents the photo being studied as an earlier note.
 */
const UPLOAD_MARKER_RE = /\[\[upload:([A-Za-z0-9-]+)\]\]/g;
/** Same rule as the agent's UPLOAD_ID (agent/src/study/store.ts); anything else is dropped. */
export const UPLOAD_ID = /^[a-f0-9-]{8,64}$/;
export const MAX_UPLOAD_IDS = 20;

export function uploadIdsIn(content: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (content ?? '').matchAll(UPLOAD_MARKER_RE)) {
    if (UPLOAD_ID.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
    if (out.length >= MAX_UPLOAD_IDS) break;
  }
  return out;
}
