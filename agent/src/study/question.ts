/**
 * Does an Examiner reply actually ask the student something? A real exam prompt doesn't always end
 * with "?": "Predict what happens to …" or "Explain why …" are questions too. Accepts a sentence that
 * ends with "?" or starts with an interrogative or an imperative prompt verb. Used by tests and the
 * live E2E. Keep this file free of imports so scripts can load it via tsx.
 */
export const QUESTION_STARTERS: ReadonlySet<string> = new Set([
  // interrogatives
  'what', 'why', 'how', 'which', 'when', 'where', 'who', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'will', 'should', 'if',
  // imperative prompt verbs
  'predict', 'explain', 'calculate', 'compare', 'contrast', 'describe', 'name', 'state', 'identify',
  'define', 'list', 'estimate', 'justify', 'derive', 'show', 'sketch', 'outline', 'evaluate',
  'determine', 'find', 'give', 'classify', 'distinguish', 'rank', 'solve', 'draw', 'label',
]);

/** Sentences with markdown emphasis, list markers and short "Label:" prefixes removed. Pure. */
export function promptSentences(text: string): string[] {
  return String(text ?? '')
    .replace(/⟦0g:[^⟧]*⟧/g, '')
    .replace(/[*_`]+/g, '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim()
      .replace(/^(?:[-•>]|\(?\d+[.)]|\(?[a-z][.)])\s+/i, '')
      .replace(/^[^.!?:]{1,40}:\s+/, '')
      .replace(/^(?:(?:next|now|then|also|finally|first|second|third|so|and|ok|okay|great|right|good)[,:]?\s+)+/i, ''))
    .filter(Boolean);
}

export function looksLikeQuestion(text: string): boolean {
  return promptSentences(text).some((s) => {
    if (s.endsWith('?')) return true;
    const first = s.match(/^[A-Za-z]+/)?.[0]?.toLowerCase();
    return !!first && QUESTION_STARTERS.has(first);
  });
}
