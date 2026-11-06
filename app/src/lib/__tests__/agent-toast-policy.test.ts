import { describe, it, expect } from "vitest";
import { notifyDecision, enqueueToast, toastPreview, MAX_VISIBLE_TOASTS, TOAST_PREVIEW_CHARS } from "../agent-toast-policy";

describe("notifyDecision", () => {
  const base = { replyChannelId: "c1", viewingChannelId: "c1", documentHidden: false, systemPermission: "default" as const };

  it("stays silent for a reply in the channel on screen", () => {
    expect(notifyDecision(base)).toBe("none");
  });
  it("toasts for a reply in another channel, or when the channel is unknown", () => {
    expect(notifyDecision({ ...base, replyChannelId: "c2" })).toBe("toast");
    expect(notifyDecision({ ...base, replyChannelId: undefined })).toBe("toast");
    expect(notifyDecision({ ...base, viewingChannelId: "" })).toBe("toast");
  });
  it("uses a system notification when the tab is hidden and allowed, otherwise nothing", () => {
    expect(notifyDecision({ ...base, documentHidden: true, systemPermission: "granted" })).toBe("system");
    expect(notifyDecision({ ...base, documentHidden: true, systemPermission: "denied" })).toBe("none");
    expect(notifyDecision({ ...base, documentHidden: true, systemPermission: "unsupported" })).toBe("none");
    // Hidden tab wins even for the channel that was on screen: the user isn't looking.
    expect(notifyDecision({ ...base, documentHidden: true, systemPermission: "granted", replyChannelId: "c1" })).toBe("system");
  });
});

describe("enqueueToast", () => {
  it(`keeps at most ${MAX_VISIBLE_TOASTS}, newest last, without mutating input`, () => {
    const prev = Object.freeze(["a", "b"]);
    expect(enqueueToast(prev, "c")).toEqual(["b", "c"]);
    expect(prev).toEqual(["a", "b"]);
    expect(enqueueToast([], "x")).toEqual(["x"]);
  });
  it("treats nonsensical limits as 1", () => {
    expect(enqueueToast(["a"], "b", 0)).toEqual(["b"]);
    expect(enqueueToast(["a"], "b", -3)).toEqual(["b"]);
    expect(enqueueToast(["a", "b"], "c", 2.9)).toEqual(["b", "c"]);
  });
});

describe("toastPreview", () => {
  it("strips 0G/upload markers, markdown and tool lines", () => {
    const raw = "**Notes read — Photosynthesis** (Biology Ch. 4)\n\n## Cleaned notes\n- *light* reactions in `thylakoid`\n[tool: read_notes]\n→ call\n← ok\nSee [docs](https://x.y)\n\n⟦0g:27634878-a676-4163-a3f0-b8b064ffddc8⟧";
    expect(toastPreview(raw, 500)).toBe("Notes read — Photosynthesis (Biology Ch. 4) Cleaned notes light reactions in thylakoid See docs");
  });
  it("cuts on a word boundary with an ellipsis and no trailing punctuation", () => {
    const out = toastPreview("The Calvin cycle uses ATP and NADPH, made in the light reactions, to fix carbon.", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).not.toMatch(/[,\s]…$/);
    expect(out).toBe("The Calvin cycle uses ATP and NADPH…");
  });
  it("hard-cuts a single very long word instead of returning nothing", () => {
    expect(toastPreview("x".repeat(200), 10)).toBe(`${"x".repeat(10)}…`);
  });
  it("handles empty, null and marker-only input", () => {
    expect(toastPreview("")).toBe("");
    expect(toastPreview(null)).toBe("");
    expect(toastPreview(undefined)).toBe("");
    expect(toastPreview("\n\n⟦0g:abc⟧")).toBe("");
  });
  it(`defaults to ${TOAST_PREVIEW_CHARS} characters`, () => {
    expect(toastPreview("word ".repeat(100)).length).toBeLessThanOrEqual(TOAST_PREVIEW_CHARS + 1);
  });
});
