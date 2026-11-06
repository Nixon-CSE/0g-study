/**
 * Flashcards travel with the Tutor's reply, by code. `study_log` records the cards in the turn's request
 * context; after the model's reply is final the runtime attaches this canonical block (unless the reply
 * already lists the cards), so the Examiner, which only receives the reply text, always sees them.
 *
 * Final message order: answer → **Flashcards** block → hand-off line (`@study-examiner`) → ⟦0g:…⟧ marker.
 */

export interface Flashcard { q: string; a: string }

export const MAX_CARDS = 8;
export const MAX_Q_CHARS = 200;
export const MAX_A_CHARS = 280;
/** The whole block, header included. Keeps the Examiner's invocation text small. */
export const MAX_BLOCK_CHARS = 2000;
export const FLASHCARDS_HEADER = '**Flashcards**';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Card text is model output that lands in a message the backend and the UI parse, so it must not carry:
 * an @-mention (would trigger an extra hand-off), an `[[upload:…]]` marker, a `⟦0g:…⟧` marker, or a
 * newline (could forge a hand-off line or a heading). The visible text stays readable.
 */
export function neutralizeCardText(s: string): string {
  return String(s ?? '')
    .replace(/[⟦⟧]/g, '')
    .replace(/\[\[/g, '[').replace(/\]\]/g, ']')
    .replace(/@(?=[A-Za-z0-9_-])/g, '＠')
    .replace(/\s+/g, ' ')
    .trim();
}

const normQ = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** True when at least half of the cards' questions already appear in the reply (the model wrote them). */
export function cardsAlreadyInReply(reply: string, cards: Flashcard[]): boolean {
  const qs = cards.map((c) => normQ(neutralizeCardText(c.q))).filter(Boolean);
  if (qs.length === 0) return true;
  const body = ` ${normQ(reply)} `;
  const found = qs.filter((q) => body.includes(` ${q} `)).length;
  return found * 2 >= qs.length;
}

/** The canonical block, or null when there is nothing worth showing. Capped per card and in total. */
export function formatFlashcardsBlock(cards: Flashcard[]): string | null {
  const lines: string[] = [];
  let size = FLASHCARDS_HEADER.length;
  for (const c of cards) {
    if (lines.length >= MAX_CARDS) break;
    const q = clip(neutralizeCardText(c.q), MAX_Q_CHARS);
    const a = clip(neutralizeCardText(c.a), MAX_A_CHARS);
    if (!q || !a) continue;
    const line = `${lines.length + 1}. Q: ${q} — A: ${a}`;
    if (size + 1 + line.length > MAX_BLOCK_CHARS) break;
    lines.push(line);
    size += 1 + line.length;
  }
  return lines.length ? [FLASHCARDS_HEADER, ...lines].join('\n') : null;
}

// Trailing @-handles (the hand-off), on their own line or at the end of the last line.
const TRAILING_HANDOFF_RE = /(?:[ \t]*@[A-Za-z0-9_-]{3,32}[ \t]*[.!]?\s*)+$/;

/**
 * Put the flashcards block into the reply before its trailing hand-off line. Returns the reply unchanged
 * when there are no cards or the reply already lists them. Does not touch the ⟦0g:…⟧ marker: the runtime
 * appends that afterwards, so it stays the very last thing in the message.
 */
export function attachFlashcards(reply: string, cards: Flashcard[] | undefined): string {
  if (!cards?.length || cardsAlreadyInReply(reply, cards)) return reply;
  const block = formatFlashcardsBlock(cards);
  if (!block) return reply;
  const m = reply.match(TRAILING_HANDOFF_RE);
  const handoff = m ? m[0].trim().replace(/[.!]$/, '') : '';
  const head = (m ? reply.slice(0, m.index) : reply).trimEnd();
  return [head, block, handoff].filter(Boolean).join('\n\n');
}
