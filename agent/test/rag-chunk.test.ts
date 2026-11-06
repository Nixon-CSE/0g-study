import { describe, it, expect } from 'vitest';
import { chunkMarkdown, HARD_MAX_CHARS } from '../src/rag/chunk.js';

describe('chunkMarkdown', () => {
  it('returns nothing for empty / whitespace / non-string input', () => {
    expect(chunkMarkdown('')).toEqual([]);
    expect(chunkMarkdown('  \n\n \t')).toEqual([]);
    expect(chunkMarkdown(undefined as any)).toEqual([]);
  });

  it('keeps the heading path as context and splits on headings', () => {
    const md = '# Biology\nintro line\n## Photosynthesis\nLight makes sugar.\n### Calvin cycle\nRuBisCO fixes CO2.\n# History\nThe Bastille fell.';
    const c = chunkMarkdown(md);
    expect(c.map((x) => x.heading)).toEqual(['Biology', 'Biology > Photosynthesis', 'Biology > Photosynthesis > Calvin cycle', 'History']);
    expect(c[2].text).toBe('RuBisCO fixes CO2.');
    expect(c.map((x) => x.n)).toEqual([1, 2, 3, 4]);
  });

  it('packs small paragraphs together up to maxChars', () => {
    const md = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} has some words.`).join('\n\n');
    const c = chunkMarkdown(md, { maxChars: 120, overlap: 0 });
    expect(c.length).toBeGreaterThan(1);
    for (const x of c) expect(x.text.length).toBeLessThanOrEqual(120);
    expect(c.map((x) => x.text).join('\n\n')).toBe(md);
  });

  it('splits a single huge paragraph by sentences, then by words, never above maxChars', () => {
    const sentences = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} explains one idea clearly.`).join(' ');
    const noPunct = 'word '.repeat(600).trim();
    for (const md of [sentences, noPunct]) {
      const c = chunkMarkdown(md, { maxChars: 300, overlap: 60 });
      expect(c.length).toBeGreaterThan(3);
      for (const x of c) expect(x.text.length).toBeLessThanOrEqual(300);
    }
  });

  it('never splits a formula line, even inside a long paragraph', () => {
    const formula = '6CO2 + 6H2O + light → C6H12O6 + 6O2, and ΔG = ΔH − TΔS. Then F = m. a holds too.';
    const prose = Array.from({ length: 30 }, (_, i) => `Filler sentence ${i} here.`).join(' ');
    const c = chunkMarkdown(`${prose}\n${formula}\n${prose}`, { maxChars: 200, overlap: 0 });
    expect(c.filter((x) => x.text.includes(formula))).toHaveLength(1);
  });

  it('keeps fenced code and $$ math blocks whole, even across blank lines', () => {
    const code = '```python\ndef f(x):\n\n    return x * 2\n```';
    const math = '$$\n\\int_0^1 x^2 dx\n\n= 1/3\n$$';
    const filler = 'Some prose before. '.repeat(5);
    const c = chunkMarkdown(`${filler}\n\n${code}\n\n${filler}\n\n${math}`, { maxChars: 100, overlap: 0 });
    expect(c.some((x) => x.text.includes(code))).toBe(true);
    expect(c.some((x) => x.text.includes(math))).toBe(true);
  });

  it('lets an oversized code block be its own chunk, but cuts at HARD_MAX_CHARS on line boundaries', () => {
    const lines = Array.from({ length: 600 }, (_, i) => `x${i} = ${i}`);
    const code = '```\n' + lines.join('\n') + '\n```';
    const c = chunkMarkdown(code, { maxChars: 200 });
    for (const x of c) expect(x.text.length).toBeLessThanOrEqual(HARD_MAX_CHARS);
    expect(c.map((x) => x.text).join('\n')).toBe(code);
  });

  it('handles unicode (CJK punctuation, emoji, accents) without breaking characters', () => {
    const md = '# 光合作用\n' + '植物は光を使って糖を作る。'.repeat(40) + '\n\n🌱 Élève: ça marche.';
    const c = chunkMarkdown(md, { maxChars: 150, overlap: 0 });
    expect(c[0].heading).toBe('光合作用');
    for (const x of c) {
      expect(x.text.length).toBeLessThanOrEqual(150);
      expect(x.text).not.toMatch(/�/);
    }
    expect(c.some((x) => x.text.includes('🌱 Élève: ça marche.'))).toBe(true);
  });

  it('carries a small trailing unit forward as overlap', () => {
    const md = Array.from({ length: 8 }, (_, i) => `Idea ${i} is short.`).join('\n\n');
    const c = chunkMarkdown(md, { maxChars: 60, overlap: 30 });
    for (let i = 1; i < c.length; i++) {
      const prevLast = c[i - 1].text.split('\n\n').pop()!;
      expect(c[i].text.startsWith(prevLast)).toBe(true);
    }
  });

  it('is deterministic and normalises CRLF', () => {
    const md = '# A\r\nOne.\r\n\r\nTwo.\r\n## B\r\nThree.';
    expect(chunkMarkdown(md)).toEqual(chunkMarkdown(md));
    expect(chunkMarkdown(md)).toEqual(chunkMarkdown(md.replace(/\r\n/g, '\n')));
  });
});
