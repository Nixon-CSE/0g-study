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

export function parseMarkers(content: string): ParsedMarkers {
  const requestIds: string[] = [];
  const uploadIds: string[] = [];
  const text = content
    .replace(ZG_RE, (_m, ids: string) => {
      requestIds.push(...ids.split(",").map((s) => s.trim()).filter(Boolean));
      return "";
    })
    .replace(UPLOAD_RE, (_m, id: string) => { uploadIds.push(id); return ""; })
    .trim();
  return { text, requestIds, uploadIds };
}

export function withUploadMarker(text: string, uploadId: string | null): string {
  return uploadId ? `${text.trim()} [[upload:${uploadId}]]`.trim() : text;
}

/** Short badge label: `0G · abcdef12…` plus `+N` for extra ids. */
export function badgeLabel(ids: string[]): string {
  if (ids.length === 0) return "";
  return `0G · ${ids[0].slice(0, 8)}…${ids.length > 1 ? ` +${ids.length - 1}` : ""}`;
}
