import { describe, it, expect } from "vitest";
import { emptyChannelHint, EMPTY_NO_AGENTS, EMPTY_WITH_AGENTS } from "../empty-state";

describe("emptyChannelHint", () => {
  it("only asks to invite an agent when there are none", () => {
    expect(emptyChannelHint(0)).toBe(EMPTY_NO_AGENTS);
    expect(emptyChannelHint(undefined)).toBe(EMPTY_NO_AGENTS);
    expect(emptyChannelHint(3)).toBe("Attach a notes photo with + and mention @study-note-reader to start.");
    expect(EMPTY_WITH_AGENTS).not.toMatch(/invite/i);
  });
});
