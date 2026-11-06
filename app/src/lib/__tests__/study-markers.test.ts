import { describe, it, expect } from "vitest";
import { parseMarkers, withUploadMarker, badgeLabel } from "../study-markers";

describe("parseMarkers", () => {
  it("extracts request ids and strips the marker", () => {
    expect(parseMarkers("Hello\n\n⟦0g:abc,def⟧")).toEqual({ text: "Hello", requestIds: ["abc", "def"], uploadIds: [] });
  });
  it("extracts the upload marker", () => {
    expect(parseMarkers("@study-note-reader [[upload:1234-abcd]]")).toEqual({
      text: "@study-note-reader", requestIds: [], uploadIds: ["1234-abcd"],
    });
  });
  it("handles both", () => {
    const r = parseMarkers("hi [[upload:aa-bb]]\n\n⟦0g:x⟧");
    expect(r.text).toBe("hi");
    expect(r.requestIds).toEqual(["x"]);
    expect(r.uploadIds).toEqual(["aa-bb"]);
  });
  it("leaves plain text alone and yields no badge ids", () => {
    expect(parseMarkers("just text")).toEqual({ text: "just text", requestIds: [], uploadIds: [] });
  });
  it("is stable across repeated calls (no stateful regex)", () => {
    const m = "a [[upload:aa-bb]]";
    expect(parseMarkers(m).uploadIds).toEqual(["aa-bb"]);
    expect(parseMarkers(m).uploadIds).toEqual(["aa-bb"]);
  });
});

describe("helpers", () => {
  it("appends the upload marker, allowing attachment-only sends", () => {
    expect(withUploadMarker("read this", "id-1")).toBe("read this [[upload:id-1]]");
    expect(withUploadMarker("", "id-1")).toBe("[[upload:id-1]]");
    expect(withUploadMarker("plain", null)).toBe("plain");
  });
  it("formats the badge label", () => {
    expect(badgeLabel([])).toBe("");
    expect(badgeLabel(["0123456789abcdef"])).toBe("0G · 01234567…");
    expect(badgeLabel(["0123456789abcdef", "b", "c"])).toBe("0G · 01234567… +2");
  });
});

describe("citedNoteDays (study memory chip)", () => {
  it("finds the days of past-notes citations in agent replies only", async () => {
    const { citedNoteDays } = await import("../study-markers");
    const t = "Like before [notes · 2026-11-05 · #2] and [notes · 2026-11-05 · #3], see [notes · 2026-11-01 · #1].";
    expect(citedNoteDays(t, true)).toEqual(["2026-11-05", "2026-11-01"]);
    expect(citedNoteDays(t, false)).toEqual([]);
    expect(citedNoteDays("[kb · Syllabus · #1] [notes · yesterday · #1]", true)).toEqual([]);
  });
});
