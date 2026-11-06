import { describe, it, expect } from 'vitest';
import { looksLikeQuestion } from '../src/study/question.js';

// The three Examiner replies the old `includes('?')` check rejected (live E2E, 2026-11-06 08:33 UTC).
const REJECTED = [
  "Here's your first one, and it's a step past the card:\n\nA plant sits under bright light with plenty of CO₂, so neither of those is limiting. You then gradually *dim* the light while holding CO₂ and temperature constant. Explain what happens to the ATP and NADPH supply, what happens to RuBisCO's *rate* of carbon fixation, and why the Calvin cycle can't simply \"speed up to compensate.\" Use the bottleneck idea, not just the words.\n\nAnswer in the channel.",
  "One question for you — answer here in the channel:\n\n**A leaf is sealed in a clear chamber with plenty of CO₂ and steady light. You then swap the light for a green bulb of the same intensity. Predict what happens to the rate of photosynthesis, and explain it in terms of the two stages — not just \"green light is bad.\"**",
  "Here's your first one — answer in the channel:\n\n**Card 3, sharpened:** Suppose you block RuBisCO with an inhibitor. Predict what happens to the *rate of O₂ release* over the next few minutes, and explain the mechanism behind the shape of that curve — not just \"it stops.\"\n\nTwo things I want in your answer: what happens to the ATP and NADPH pools, and why a *stalled* Calvin cycle eventually slows the light reactions rather than just leaving them running happily.",
];

describe('looksLikeQuestion', () => {
  it('accepts the three real Examiner questions that have no "?"', () => {
    for (const r of REJECTED) expect(looksLikeQuestion(r), r.slice(0, 60)).toBe(true);
  });

  it('accepts "?" questions, labelled prompts and numbered prompts', () => {
    expect(looksLikeQuestion('Why does the Calvin cycle need NADPH? Answer in the channel.')).toBe(true);
    expect(looksLikeQuestion('**Question:** calculate the net force on a 5 kg block accelerating at 2 m/s².')).toBe(true);
    expect(looksLikeQuestion('1. Compare the light reactions with the Calvin cycle.')).toBe(true);
    expect(looksLikeQuestion('Correct: water is split in PSII. Next, describe where the O₂ goes. ⟦0g:abc-1⟧')).toBe(true);
  });

  it('rejects replies that ask nothing', () => {
    for (const s of [
      'Great work today. The Calvin cycle fixes carbon into sugar.',
      'Answer in the channel.',
      'The key idea is what happens when light is limiting.',
      '',
    ]) expect(looksLikeQuestion(s), s).toBe(false);
  });
});
