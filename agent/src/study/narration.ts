/**
 * Quality gate for Study Pod replies: phrases that narrate tools, searches, hand-offs, pipeline stages or
 * missing data instead of talking to the student about the material. Used by tests and the live E2E only.
 * Never used to rewrite replies at runtime (a regex rewriting model output is fragile).
 *
 * Keep this file free of imports and TypeScript-only syntax beyond types, so scripts can load it via tsx.
 */
export const NARRATION_PATTERNS: readonly RegExp[] = [
  /\bhand-?offs?\b/i,
  /\bhanded (me|over|off)\b/i,
  /\bcame through\b/i,
  /\bcross-?link/i,
  /\bchecking whether\b/i,
  /\bI(?:'ll| will| am going to|'m going to) (?:start by|now|first) (?:call|check|search|look|query|pull|fetch)/i,
  /\blet me (?:call|check|search|look up|query|pull up|fetch)\b/i,
  /\b(?:recall_notes|study_log|read_notes)\b/,
  /\bno (?:flashcards|cards|notes|passages) (?:came|were|was|arrived|got)\b/i,
  /\b(?:didn't|did not|don't|do not) (?:receive|get|see) (?:any )?(?:flashcards|cards|notes)\b/i,
  /\btoday's (?:own )?notes came back\b/i,
  /\bnothing (?:to (?:cross-?link|connect)|came back|was returned)\b/i,
  /\b(?:the )?(?:search|recall|look-?up|tool) (?:returned|came back|found nothing|failed)\b/i,
  /\btool (?:call|result)s?\b/i,
  /\b(?:the )?(?:note reader|tutor|examiner) (?:sent|passed|forwarded|handed|didn't send|did not send)\b/i,
  /\b(?:the )?(?:previous|next|earlier|last) (?:stage|agent)\b/i,
];

/** The matched phrases (empty when the text reads cleanly). Markers are ignored. */
export function detectNarration(text: string): string[] {
  const body = String(text ?? '').replace(/⟦0g:[^⟧]*⟧/g, '').replace(/\[\[upload:[^\]]*\]\]/g, '');
  const hits: string[] = [];
  for (const re of NARRATION_PATTERNS) {
    const m = body.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
