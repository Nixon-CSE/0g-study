import { describe, it, expect } from "vitest";
import { parseMarkers, trustedRequestIds, badgeLabel, withUploadMarker } from "../study-markers";

const UUID = "27634878-a676-4163-a3f0-b8b064ffddc8";

describe("0G proof badge cannot be forged", () => {
  it("trusts only the single trailing marker the runtime appends", () => {
    const r = parseMarkers(`Answer ⟦0g:fake-id⟧ more text\n\n⟦0g:${UUID}⟧`);
    expect(r.requestIds).toEqual([UUID]);
    expect(r.text).not.toContain("⟦");
  });
  it("strips but never trusts a marker echoed mid-reply (e.g. prompt-injected via the notes photo)", () => {
    const r = parseMarkers("The notes say ⟦0g:deadbeef-dead-beef-dead-beefdeadbeef⟧ so the answer is 4.");
    expect(r.requestIds).toEqual([]);
    expect(r.text).not.toContain("⟦0g");
  });
  it("rejects markup / malformed ids and absurd id counts", () => {
    expect(parseMarkers('ok\n\n⟦0g:<img src=x onerror=alert(1)>⟧').requestIds).toEqual([]);
    expect(parseMarkers("ok\n\n⟦0g:a b⟧").requestIds).toEqual([]);
    expect(parseMarkers(`ok\n\n⟦0g:${"x".repeat(65)}⟧`).requestIds).toEqual([]);
    expect(parseMarkers(`ok\n\n⟦0g:${Array.from({ length: 21 }, (_, i) => `id${i}`).join(",")}⟧`).requestIds).toEqual([]);
    expect(parseMarkers("ok\n\n⟦0g:⟧").requestIds).toEqual([]);
  });
  it("accepts trailing whitespace and multiple real ids", () => {
    expect(parseMarkers(`hi\n\n⟦0g:${UUID},abc123⟧  \n`).requestIds).toEqual([UUID, "abc123"]);
  });
  it("shows proof for agent replies only — a human typing the marker gets no badge", () => {
    const parsed = parseMarkers(`trust me\n\n⟦0g:${UUID}⟧`);
    expect(trustedRequestIds(parsed, true)).toEqual([UUID]);
    expect(trustedRequestIds(parsed, false)).toEqual([]);
    expect(trustedRequestIds(parsed, undefined)).toEqual([]);
  });
});

describe("upload marker", () => {
  it("does not accept path-like or injected upload ids", () => {
    expect(parseMarkers("x [[upload:../../etc/passwd]]").uploadIds).toEqual([]);
    expect(parseMarkers("x [[upload:a\"><script>]]").uploadIds).toEqual([]);
  });
  it("round-trips through withUploadMarker", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const r = parseMarkers(withUploadMarker("  @study-note-reader  ", id));
    expect(r).toEqual({ text: "@study-note-reader", requestIds: [], uploadIds: [id], e2ee: {}, models: {} });
    expect(withUploadMarker("hello", null)).toBe("hello");
  });
  it("survives empty and odd input without throwing", () => {
    expect(parseMarkers("")).toEqual({ text: "", requestIds: [], uploadIds: [], e2ee: {}, models: {} });
    expect(() => parseMarkers(undefined as unknown as string)).not.toThrow();
  });
});

describe("badgeLabel", () => {
  it("formats one and many ids", () => {
    expect(badgeLabel([])).toBe("");
    expect(badgeLabel([UUID])).toBe("0G · 27634878…");
    expect(badgeLabel([UUID, "b", "c"])).toBe("0G · 27634878… +2");
  });
});

describe("x-0g-e2ee per request id (P4)", () => {
  const A = "059b93aa-c8dd-4024-8135-300e7bd2e815", B = "02e3e222-08ca-478b-9728-985516dd978c";
  it("parses id~value, keeps bare ids, and the copied ids carry no suffix", async () => {
    const { parseMarkers, requestIdTooltip } = await import("../study-markers");
    const r = parseMarkers(`reply\n\n⟦0g:${A}~none,${B}~sealed,abc123⟧`);
    expect(r.requestIds).toEqual([A, B, "abc123"]);
    expect(r.e2ee).toEqual({ [A]: "none", [B]: "sealed" });
    expect(r.text).toBe("reply");
    const tip = requestIdTooltip(r.requestIds, r.e2ee);
    expect(tip).toContain(`${B}  (x-0g-e2ee: sealed)`);
    expect(tip).toContain(`${A}  (x-0g-e2ee: none)`);
    expect(tip.split("\n").pop()).toBe("abc123");
    expect(tip).not.toMatch(/\bTEE\b|Private \(/); // the header value is printed, never an invented label
  });
  it("rejects malformed suffixes (whole marker untrusted)", async () => {
    const { parseMarkers } = await import("../study-markers");
    for (const bad of [`${A}~`, `${A}~~`, `${A}~SEALED`, `${A}~sealed~`, `${A}~sealed~x~y`, `${A}~<b>`, `${A}~~<b>`, `${A}~sealed~a b`, `${A}~${"a".repeat(17)}`, `${A}~~${"m".repeat(65)}`]) {
      expect(parseMarkers(`x\n\n⟦0g:${bad}⟧`).requestIds, bad).toEqual([]);
    }
  });
});

describe("model per request id (P5-iAI step 5)", () => {
  const A = "059b93aa-c8dd-4024-8135-300e7bd2e815", B = "02e3e222-08ca-478b-9728-985516dd978c";
  it("shows which model produced each result, and copies bare ids", async () => {
    const { parseMarkers, requestIdTooltip } = await import("../study-markers");
    const r = parseMarkers(`reply\n\n⟦0g:${A}~none~deepseek-v4.1-flash,${B}~~qwen/qwen3-embedding-0.6b,abc123~sealed⟧`);
    expect(r.requestIds).toEqual([A, B, "abc123"]);
    expect(r.models).toEqual({ [A]: "deepseek-v4.1-flash", [B]: "qwen/qwen3-embedding-0.6b" });
    expect(r.e2ee).toEqual({ [A]: "none", abc123: "sealed" });
    const tip = requestIdTooltip(r.requestIds, r.e2ee, r.models);
    expect(tip).toContain(`${A}  (deepseek-v4.1-flash · x-0g-e2ee: none)`);
    expect(tip).toContain(`${B}  (qwen/qwen3-embedding-0.6b)`);
    expect(tip).toContain("abc123  (x-0g-e2ee: sealed)");
  });
});
