import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contrastRatio, parseHex, relativeLuminance, resolveRootVars, WCAG_AA_NORMAL_TEXT,
} from "../contrast";

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2); // the classic "just fails AA" grey
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000")).toBe(0);
  });
  it("is symmetric and accepts short hex / missing #", () => {
    expect(contrastRatio("#131315", "#f6f6f4")).toBeCloseTo(contrastRatio("f6f6f4", "#131315"), 10);
    expect(parseHex("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
    expect(parseHex("ABCDEF")).toEqual([0xab, 0xcd, 0xef]);
  });
  it("rejects malformed colours instead of guessing", () => {
    for (const bad of ["", "#12", "#12345", "#gggggg", "rgb(0,0,0)", "red", "#1234567"]) {
      expect(() => parseHex(bad), bad).toThrow(/not a hex colour/);
    }
  });
});

describe("resolveRootVars", () => {
  it("resolves chains, fallbacks and multiple :root blocks; ignores comments", () => {
    const css = `/* --ignored: #000; */ :root { --a: #111111; --b: var(--a); }
      .x { --scoped: #fff; } :root { --c: var(--b); --d: var(--nope, #222222); }`;
    expect(resolveRootVars(css)).toEqual({ "--a": "#111111", "--b": "#111111", "--c": "#111111", "--d": "#222222" });
  });
  it("throws on cycles and on undeclared references without a fallback", () => {
    expect(() => resolveRootVars(":root{--a:var(--b);--b:var(--a);}")).toThrow(/cycle/);
    expect(() => resolveRootVars(":root{--a:var(--missing);}")).toThrow(/undeclared/);
  });
});

/**
 * Guard for the app's real theme. Every (text token, surface token) pair the UI uses for body text
 * must meet WCAG AA. A token change that makes text unreadable fails CI here, not in front of a judge.
 */
describe("design tokens in app/globals.css meet WCAG AA", () => {
  const css = fs.readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
  const v = resolveRootVars(css);

  const lightSurfaces = ["--bf-tertiary", "--bf-primary", "--bf-quaternary", "--bf-secondary", "--bf-quinary", "--bf-chat-input"];
  const textOnLight = ["--foreground", "--bf-white", "--muted", "--bf-gray", "--subtle", "--bf-symbol", "--bf-senary",
    "--bf-fire", "--bf-banana", "--bf-yellow", "--bf-red", "--positive", "--negative", "--caution"];
  const darkSurfaces = ["--ink", "--bf-accent", "--bf-plum", "--bf-fire", "--bf-red", "--positive"];

  for (const surface of lightSurfaces) {
    for (const text of textOnLight) {
      it(`${text} on ${surface}`, () => {
        const ratio = contrastRatio(v[text], v[surface]);
        expect(ratio, `${text} (${v[text]}) on ${surface} (${v[surface]}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      });
    }
  }
  for (const surface of darkSurfaces) {
    it(`--on-ink on ${surface}`, () => {
      expect(contrastRatio(v["--on-ink"], v[surface])).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });
  }

  it("documents the bug class this guards against: light text on light surfaces is unreadable", () => {
    expect(contrastRatio(v["--on-ink"], v["--bf-quaternary"])).toBeLessThan(1.5);
    expect(contrastRatio(v["--foreground"], v["--bf-plum"])).toBeLessThan(1.5);
  });
});
