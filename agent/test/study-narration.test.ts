import { describe, it, expect } from 'vitest';
import { detectNarration } from '../src/study/narration.js';
import { formatFlashcardsBlock } from '../src/study/flashcards.js';

describe('detectNarration', () => {
  it('flags the narration seen in the 2026-11-06 session', () => {
    for (const s of [
      "No flashcards came through in that handoff, so I'll pull from the material you just laid out.",
      "I'll start by checking whether anything from your earlier notes connects to this.",
      "Today's own notes came back, so nothing to cross-link.",
    ]) expect(detectNarration(s), s).not.toEqual([]);
  });

  it('flags tool names, hand-offs, look-ups and missing-data remarks', () => {
    for (const s of [
      'I called recall_notes and it found nothing.',
      'Let me search your earlier notes first.',
      'The tutor passed me six cards.',
      "I didn't receive any flashcards, so here is a question.",
      'The search returned no earlier passages.',
      'Handing off to the next agent now.',
      'Thanks for the hand-off!',
      'The hand-off from the tutor had no cards.',
      'The tutor handed me six cards.',
      // Seen in the live E2E on 2026-11-06:
      "I don't have any notes to work from yet — the page didn't come through.",
      "I'll pull up anything related from your earlier notes, then walk you through the tricky parts.",
      "I'll walk you through the three ideas, then get your cards saved.",
      "I'll save your cards now.",
    ]) expect(detectNarration(s), s).not.toEqual([]);
  });

  it('clean tutoring, quizzing, citing and grading pass', () => {
    const clean = [
      'Think of the Calvin cycle as a factory: RuBisCO grabs CO2 and ATP plus NADPH turn it into sugar. This builds on your earlier notes [notes · 2026-11-05 · #2].',
      'Question: if a plant had plenty of light but no CO2, which molecules would pile up in the stroma, and why? Answer here in the channel.',
      'Partly right: water is split in photosystem II, but the oxygen is a by-product, not the electron source for NADPH. Next question: why does the cycle need three turns per G3P?',
      formatFlashcardsBlock([{ q: 'What does RuBisCO do?', a: 'It fixes CO2 onto RuBP.' }])!,
      'Momentum came up again: in a collision it is conserved. ⟦0g:abc-123⟧',
      "Let's put those cards to work — answer from memory.",
      // Live E2E 2026-11-06: a biology metaphor, not a pipeline hand-off.
      'Light energy becomes chemical bond energy in sugar, and the Calvin cycle is the hand-off point.',
      'ATP and NADPH are handed over to the Calvin cycle in the stroma.',
      'Go back to your earlier notes on the light reactions if this feels shaky [notes · 2026-11-05 · #1].',
    ];
    for (const s of clean) expect(detectNarration(s), s).toEqual([]);
  });
});
