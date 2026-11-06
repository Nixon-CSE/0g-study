/**
 * WCAG 2.x contrast utilities. Pure functions, no DOM, so they can guard the design tokens in tests.
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/** Minimum contrast for normal-size body text (WCAG 2.1 AA, success criterion 1.4.3). */
export const WCAG_AA_NORMAL_TEXT = 4.5;
/** Minimum contrast for large text (≥ 18.66px bold or ≥ 24px) and UI components. */
export const WCAG_AA_LARGE_TEXT = 3;

export type Rgb = readonly [r: number, g: number, b: number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse `#rgb` / `#rrggbb` (the leading `#` is optional). Throws on anything else, so typos fail loudly. */
export function parseHex(input: string): Rgb {
  const m = HEX.exec(input.trim());
  if (!m) throw new Error(`not a hex colour: ${JSON.stringify(input)}`);
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as unknown as Rgb;
}

function channel(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance in [0, 1]. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio in [1, 21]; symmetric in its arguments. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Collect the custom properties declared in every `:root { … }` block of a stylesheet and resolve
 * `var(--x)` references (with an optional fallback) to their final value.
 * Throws on reference cycles and on references to undeclared variables without a fallback.
 */
export function resolveRootVars(css: string): Record<string, string> {
  const raw: Record<string, string> = {};
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of withoutComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const decl of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      raw[decl[1]] = decl[2].trim();
    }
  }
  const resolved: Record<string, string> = {};
  const resolve = (name: string, stack: string[]): string => {
    if (name in resolved) return resolved[name];
    if (stack.includes(name)) throw new Error(`css var cycle: ${[...stack, name].join(" -> ")}`);
    if (!(name in raw)) throw new Error(`undeclared css var: ${name}`);
    const value = raw[name].replace(/var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)/gi, (_m, ref: string, fallback?: string) =>
      ref in raw ? resolve(ref, [...stack, name]) : fallback !== undefined ? fallback.trim() : resolve(ref, [...stack, name]),
    );
    resolved[name] = value;
    return value;
  };
  for (const name of Object.keys(raw)) resolve(name, []);
  return resolved;
}
