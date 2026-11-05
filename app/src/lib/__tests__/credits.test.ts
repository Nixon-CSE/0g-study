import { describe, it, expect } from "vitest";
import { formatCredits } from "../credits";

describe("formatCredits", () => {
  it("shows 3 decimals from 1 0G up and 3 significant digits below", () => {
    expect(formatCredits(2)).toBe("2.000");
    expect(formatCredits(12.34567)).toBe("12.346");
    expect(formatCredits(0.001234)).toBe("0.00123");
  });
});
