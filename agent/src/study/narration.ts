/**
 * Quality gate for Study Pod replies: phrases that narrate tools, searches, hand-offs, pipeline stages or
 * missing data instead of talking to the student about the material. Used by tests and the live E2E only.
 * Never used to rewrite replies at runtime (a regex rewriting model output is fragile).
 *
 * Keep this file free of imports and TypeScript-only syntax beyond types, so scripts can load it via tsx.
 */
/** "the page didn't come through": narrating missing data (except from the Note Reader, see below). */
export const DIDNT_COME_THROUGH = /\b(?:didn't|did not|never|doesn't|does not) (?:come|get|go) through\b/i;

export const NARRATION_PATTERNS: readonly RegExp[] = [
  // "hand-off" only in the meta sense: "the Calvin cycle is the hand-off point" is biology, not narration.
  /\b(?:in|from|through|via|after|during|with|for) (?:the|that|this|my|your|our|their) hand-?offs?\b/i,
  /\bhand-?offs? (?:came|went|was|is|didn't|did not|had|from (?:the|@)|to (?:me|the (?:examiner|tutor|next)|@))/i,
  /\bhand(?:ing|ed|s)?(?: (?:it|this|you|things))? (?:off|over) to (?:the )?(?:next (?:agent|stage|step)|@|examiner|tutor|note reader|another agent)/i,
  /\bhanded (?:me|us)\b/i,
  /\bcame through\b/i,
  DIDNT_COME_THROUGH,
  /\b(?:pull(?:ing)? up|look(?:ing)? up|look(?:ing)? through|search(?:ing)?|check(?:ing)?|dig(?:ging)? (?:up|into)) (?:anything|something|what)?[^.\n]{0,40}\b(?:earlier|past|previous|old) notes\b/i,
  /\b(?:get|getting) (?:your|the|these) (?:flash)?cards (?:saved|logged)\b/i,
  /\bI(?:'ll| will|'m going to)? ?(?:save|log|record) (?:your|the|these) (?:flash)?cards\b/i,
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

/**
 * Patterns that don't apply to one pod agent. The Note Reader telling the student a photo couldn't be
 * read ("the image didn't come through") is honest failure messaging, its rule 1 ("If it fails, say so").
 * The same words from the Tutor or Examiner still narrate missing data.
 */
export const NOT_NARRATION_FOR: Readonly<Record<string, readonly RegExp[]>> = {
  'study-note-reader': [DIDNT_COME_THROUGH],
};

/** The matched phrases (empty when the text reads cleanly). Markers are ignored. `agent` is the speaker's slug. */
export function detectNarration(text: string, opts: { agent?: string } = {}): string[] {
  const body = String(text ?? '').replace(/⟦0g:[^⟧]*⟧/g, '').replace(/\[\[upload:[^\]]*\]\]/g, '');
  const exempt = new Set(opts.agent ? NOT_NARRATION_FOR[opts.agent] ?? [] : []);
  const hits: string[] = [];
  for (const re of NARRATION_PATTERNS) {
    if (exempt.has(re)) continue;
    const m = body.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}
