import { describe, it, expect } from "vitest";
import { formatCredits } from "../credits";

describe("formatCredits", () => {
  it("shows 3 decimals from 1 0G up and 3 significant digits below", () => {
    expect(formatCredits(2)).toBe("2.000");
    expect(formatCredits(12.34567)).toBe("12.346");
    expect(formatCredits(0.001234)).toBe("0.00123");
  });
});

describe("connecting a pc.0g.ai account", () => {
  it("explains a bad prefix in plain words", async () => {
    const { keyPrefixError } = await import("../credits");
    expect(keyPrefixError("sk-abc", "mk-abc")).toBeNull();
    expect(keyPrefixError("  sk-abc ", " mk-abc\n")).toBeNull();
    expect(keyPrefixError("mk-abc", "sk-abc")).toMatch(/swapped/);
    expect(keyPrefixError("abc", "mk-abc")).toMatch(/should start with sk-/);
    expect(keyPrefixError("sk-abc", "abc")).toMatch(/should start with mk-/);
  });
  it("the call to action and direct links", async () => {
    const { CONNECT_CTA, API_KEYS_URL, MANAGEMENT_KEYS_URL } = await import("../credits");
    expect(CONNECT_CTA).toBe("Use your daily iAI credits →");
    expect(API_KEYS_URL).toBe("https://pc.0g.ai/dashboard/api-keys");
    expect(MANAGEMENT_KEYS_URL).toBe("https://pc.0g.ai/dashboard/management-keys");
  });
});
