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
    expect(r).toEqual({ text: "@study-note-reader", requestIds: [], uploadIds: [id] });
    expect(withUploadMarker("hello", null)).toBe("hello");
  });
  it("survives empty and odd input without throwing", () => {
    expect(parseMarkers("")).toEqual({ text: "", requestIds: [], uploadIds: [] });
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
