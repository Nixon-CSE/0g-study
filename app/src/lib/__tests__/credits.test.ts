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
    expect(CONNECT_CTA).toBe("⚡ Use your daily iAI credits");
    expect(API_KEYS_URL).toBe("https://pc.0g.ai/dashboard/api-keys");
    expect(MANAGEMENT_KEYS_URL).toBe("https://pc.0g.ai/dashboard/management-keys");
  });
});

describe("balance display (shapes from the real account, 2026-11-06)", () => {
  const usd = { currency: "usd" as const, available: "437504", credit: "437504", deposit: "0", unsettled: "0" };
  it("usd: micro-USD to 4 decimals, cut off rather than rounded up", async () => {
    const { formatMoney, toMicro } = await import("../credits");
    expect(formatMoney("usd", toMicro("usd", "437504"))).toBe("$0.4375");
    expect(formatMoney("usd", toMicro("usd", "437496"))).toBe("$0.4374");
    expect(formatMoney("usd", 999999)).toBe("$0.9999");
    expect(formatMoney("usd", 12_345_678)).toBe("$12.3456");
    expect(formatMoney("usd", 1034, 6)).toBe("$0.001034");
    expect(formatMoney("usd", -5)).toBe("$0.0000");
  });
  it("0g: neuron, shown as 0G and never as dollars", async () => {
    const { formatMoney, toMicro } = await import("../credits");
    expect(formatMoney("0g", toMicro("0g", "1500000000000000000"))).toBe("1.500 0G");
    expect(toMicro("0g", "abc")).toBe(0);
  });
  it("names the number honestly: deposits appear only when there are some", async () => {
    const { balanceName, balanceDetails } = await import("../credits");
    expect(balanceName(usd)).toBe("iAI / 0G credits");
    expect(balanceDetails(usd)).toEqual(["0G credits (incl. daily iAI): $0.4375"]);
    const both = { ...usd, available: "1437504", deposit: "1000000" };
    expect(balanceName(both)).toBe("0G balance");
    expect(balanceDetails(both)).toEqual(["0G credits (incl. daily iAI): $0.4375", "Deposits: $1.0000"]);
  });
  it("counts down to 00:00 UTC", async () => {
    const { untilReset } = await import("../credits");
    expect(untilReset(new Date("2026-11-06T15:31:00Z"))).toBe("8h 29m");
    expect(untilReset(new Date("2026-11-06T23:59:59Z"))).toBe("0h 1m");
  });
  it("billing proof and session lines", async () => {
    const { billedLine, sessionLine } = await import("../credits");
    const call = { cost: "1034", creditUsed: "1034", depositUsed: "0", model: "gemini-2.5-flash" };
    expect(billedLine(call, "usd")).toBe("billed to your 0G account: $0.001034 · credits · gemini-2.5-flash");
    expect(billedLine({ ...call, creditUsed: "0", depositUsed: "1034", model: null }, "usd")).toBe("billed to your 0G account: $0.001034 · deposits");
    expect(billedLine({ ...call, creditUsed: "1000", depositUsed: "34" }, "usd")).toContain("credits + deposits");
    expect(sessionLine([call, { ...call, cost: "4000" }], "usd")).toBe("This session: 2 calls · $0.0050 from your credits");
    expect(sessionLine([call], "usd")).toBe("This session: 1 call · $0.0010 from your credits");
    expect(sessionLine([], "usd")).toBe("This session: 0 calls · $0.0000 from your credits");
  });
});

describe("session request ids", () => {
  it("remembers reply ids once, keeps the newest 100, and tells the status bar", async () => {
    const { clearSessionIds, notePodReplies, rememberIds, sessionIds, POD_REPLY_EVENT } = await import("../billing-session");
    clearSessionIds();
    let events = 0;
    const target = new EventTarget();
    target.addEventListener(POD_REPLY_EVENT, () => { events++; });
    (globalThis as { window?: unknown }).window = target;
    notePodReplies(["a\n\n⟦0g:abc123~none~m,def456⟧", "no marker", null]);
    notePodReplies(["b\n\n⟦0g:abc123⟧"]);
    notePodReplies(["nothing billed here"]);
    expect(sessionIds()).toEqual(["abc123", "def456"]);
    expect(events).toBe(2);
    rememberIds(Array.from({ length: 120 }, (_, i) => `id${i}`));
    expect(sessionIds()).toHaveLength(100);
    expect(sessionIds().at(-1)).toBe("id119");
    clearSessionIds();
    expect(sessionIds()).toEqual([]);
    delete (globalThis as { window?: unknown }).window;
  });
});
