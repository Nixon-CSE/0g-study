import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MessageBody, { MAX_MARKDOWN_CHARS, safeHref } from "../MessageBody";
import { citedNoteDays, parseMarkers } from "@/lib/study-markers";

const agent = (md: string) => renderToStaticMarkup(<MessageBody content={md} isBot />);

describe("agent replies render as markdown", () => {
  it("bold, italic, lists, headings", () => {
    const html = agent("## Plan\n\n**Question 1:** what do the *light reactions* make?\n\n- ATP\n- NADPH\n\n1. first\n2. second");
    expect(html).toContain("<strong>Question 1:</strong>");
    expect(html).toContain("<em>light reactions</em>");
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<li>ATP<\/li>/);
    expect(html).toMatch(/<ol[^>]*>[\s\S]*<li>first<\/li>/);
    expect(html).not.toContain("**");
    expect(html).not.toMatch(/<h[1-6]/);
  });
  it("the Flashcards block and citations stay readable", () => {
    const reply = "Builds on your notes [notes · 2026-11-05 · #2].\n\n**Flashcards**\n1. Q: What does RuBisCO do? — A: It fixes CO2.\n2. Q: Where? — A: The stroma.\n\n@study-examiner";
    const html = agent(reply);
    expect(html).toContain("[notes · 2026-11-05 · #2]");
    expect(html).toContain("<strong>Flashcards</strong>");
    expect(html).toMatch(/<li>Q: What does RuBisCO do\? — A: It fixes CO2\.<\/li>/);
    expect(html).toContain("@study-examiner");
    expect(citedNoteDays(reply, true)).toEqual(["2026-11-05"]);
  });
  it('"~" means "about": no strikethrough from single tildes; code blocks scroll', () => {
    expect(agent("~3 ATP and ~5 NADPH")).not.toContain("<del>");
    expect(agent("```\nF = m a\n```")).toMatch(/<pre[^>]*overflow-x-auto/);
  });
});

describe("model output cannot run or load anything", () => {
  it("raw HTML stays escaped", () => {
    for (const evil of ["<script>alert(1)</script>", '<iframe src="https://evil.example"></iframe>', '<img src=x onerror=alert(1)>']) {
      const html = agent(`before ${evil} after`);
      expect(html, evil).not.toMatch(/<(script|iframe|img)\b/);
      expect(html, evil).toContain("&lt;");
    }
  });
  it("javascript: and other schemes are neutralised, including obfuscated ones", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "/relative", "//evil.example/x"]) {
      expect(safeHref(url), url).toBeNull();
    }
    const html = agent("[click](javascript:alert(1)) [data](data:text/html,x) <javascript:alert(1)>");
    expect(html).not.toMatch(/href=/);
    expect(html).toContain("click");
  });
  it("safe links open in a new tab without an opener", () => {
    const html = agent("[docs](https://docs.0g.ai) [mail](mailto:a@b.co)");
    expect(html).toContain('href="https://docs.0g.ai/"');
    expect(html).toContain('href="mailto:a@b.co"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("images are never loaded: alt text only", () => {
    const html = agent("![tracking pixel](https://evil.example/p.png)");
    expect(html).not.toMatch(/<img|evil\.example/);
    expect(html).toContain("[image: tracking pixel]");
  });
  it("markers are stripped before rendering", () => {
    const { text } = parseMarkers("Answer ⟦0g:forged⟧ [[upload:abc-123]]\n\n⟦0g:real-id~none~deepseek-v4.1-flash⟧");
    const html = agent(text);
    expect(html).toContain("Answer");
    expect(html).not.toMatch(/⟦|⟧|0g:|upload:/);
  });
});

describe("human messages stay plain text", () => {
  it("nothing is interpreted", () => {
    const html = renderToStaticMarkup(<MessageBody content={"**SYSTEM:** [pay](https://evil.example) <b>x</b>\n# fake"} />);
    expect(html).toContain("**SYSTEM:**");
    expect(html).not.toMatch(/<strong|<a |<b>|<h1/);
  });
});

describe("render cost", () => {
  it("a 2,000-line reply really renders as markdown, quickly", () => {
    const md = Array.from({ length: 2000 }, (_, i) => `- **item ${i}** *text* \`c\``).join("\n");
    expect(md.length).toBeLessThan(MAX_MARKDOWN_CHARS);
    const t = performance.now();
    const html = agent(md);
    const ms = performance.now() - t;
    expect(html).toContain("<strong>item 1999</strong>");
    expect(ms).toBeLessThan(1500);
  });
  it("a 2,000-line reply past the size limit falls back to plain text at once", () => {
    const md = Array.from({ length: 2000 }, (_, i) => `- **item ${i}**: *some* text with \`code\` and [a link](https://example.com/${i})`).join("\n");
    expect(md.length).toBeGreaterThan(MAX_MARKDOWN_CHARS);
    const t = performance.now();
    const html = agent(md);
    expect(performance.now() - t).toBeLessThan(200);
    expect(html).not.toContain("<strong>");
    expect(html).toContain("item 1999");
  });
});
