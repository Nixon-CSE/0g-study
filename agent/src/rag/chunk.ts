/**
 * Markdown chunker for study notes and knowledge-base docs. Deterministic and pure.
 *
 * Splits on headings, then paragraphs, then sentences, and packs the pieces into chunks of at most
 * `maxChars`. Atomic units are never split:
 *   - fenced code blocks (``` / ~~~) and `$$ … $$` display-math blocks,
 *   - formula lines (anything with `=`, `$`, `\(`, `\[`, arrows, …): a sentence splitter would cut "F = m. a".
 * One unit larger than `maxChars` becomes its own (oversized) chunk. The only exception is a unit beyond
 * HARD_MAX_CHARS, which is cut at line boundaries so a single chunk can never exceed the embedding
 * model's context. Each chunk keeps its heading path ("Photosynthesis > Light reactions") as context.
 */
export interface Chunk {
  /** 1-based position in the document. */
  n: number;
  /** Heading path, outermost first, joined with " > "; "" before the first heading. */
  heading: string;
  text: string;
}

export interface ChunkOptions {
  maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk (whole units only). */
  overlap?: number;
}

export const HARD_MAX_CHARS = 8000;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const MATH_FENCE = /^\s*\$\$/;
const FORMULA = /[=≈≠≤≥→←⇌↔∑∫√^]|\$|\\\(|\\\[|->|<-/;

type Block = { heading: string; text: string; atomic: boolean };

/** Split a sentence-y paragraph; formula lines stay whole. */
function splitSentences(line: string): string[] {
  if (FORMULA.test(line)) return [line];
  return line.split(/(?<=[.!?])\s+|(?<=[。！？])/u).map((s) => s.trim()).filter(Boolean);
}

/** Cut text at whitespace (or hard, as a last resort) into pieces of at most `max` chars. */
function hardWrap(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Cut an oversized atomic block at line boundaries, each piece <= max (unless a single line is longer). */
function splitLines(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + 1 + line.length > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out.flatMap((p) => (p.length > max ? hardWrap(p, max) : [p]));
}

function toBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const path: string[] = [];
  const blocks: Block[] = [];
  let para: string[] = [];
  const heading = () => path.filter(Boolean).join(' > ');
  const flushPara = () => {
    if (para.length) blocks.push({ heading: heading(), text: para.join('\n'), atomic: false });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(FENCE);
    if (fence || MATH_FENCE.test(line)) {
      flushPara();
      const closer = fence ? fence[1] : '$$';
      const body = [line];
      // A one-line `$$ x $$` closes itself.
      const selfClosed = !fence && line.trim().length > 2 && line.trim().endsWith('$$');
      if (!selfClosed) {
        for (i++; i < lines.length; i++) {
          body.push(lines[i]);
          if (lines[i].trim().startsWith(closer)) break;
        }
      }
      blocks.push({ heading: heading(), text: body.join('\n'), atomic: true });
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      flushPara();
      const level = h[1].length;
      path.length = level - 1;
      path[level - 1] = h[2].trim();
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Break a block into units no larger than maxChars where allowed. */
function toUnits(b: Block, maxChars: number): string[] {
  if (b.atomic) return b.text.length > HARD_MAX_CHARS ? splitLines(b.text, HARD_MAX_CHARS) : [b.text];
  if (b.text.length <= maxChars) return [b.text];
  const units: string[] = [];
  for (const line of b.text.split('\n')) {
    for (const s of splitSentences(line.trim())) {
      if (s.length <= maxChars) units.push(s);
      else if (FORMULA.test(s)) units.push(...(s.length > HARD_MAX_CHARS ? hardWrap(s, HARD_MAX_CHARS) : [s]));
      else units.push(...hardWrap(s, maxChars));
    }
  }
  return units;
}

export function chunkMarkdown(text: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = Math.max(100, opts.maxChars ?? 1200);
  const overlap = Math.max(0, Math.min(opts.overlap ?? 150, Math.floor(maxChars / 2)));
  if (typeof text !== 'string' || !text.trim()) return [];

  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let curHeading: string | null = null;
  const emit = () => {
    if (!cur.length) return;
    chunks.push({ n: chunks.length + 1, heading: curHeading ?? '', text: cur.join('\n\n') });
  };

  for (const block of toBlocks(text)) {
    if (curHeading !== null && block.heading !== curHeading) { emit(); cur = []; curLen = 0; }
    curHeading = block.heading;
    for (const unit of toUnits(block, maxChars)) {
      const add = unit.length + (cur.length ? 2 : 0);
      if (cur.length && curLen + add > maxChars) {
        emit();
        // Overlap: carry the last unit forward when it is small enough.
        const last = cur[cur.length - 1];
        cur = overlap && last.length <= overlap && last.length + 2 + unit.length <= maxChars ? [last] : [];
        curLen = cur.length ? last.length : 0;
      }
      curLen += unit.length + (cur.length ? 2 : 0);
      cur.push(unit);
    }
  }
  emit();
  return chunks;
}
