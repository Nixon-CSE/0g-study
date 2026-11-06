import { describe, it, expect } from "vitest";
import { connectionState, CONNECTION_LABEL } from "../agent-connections";

describe("connectionState", () => {
  it("Telegram is Active only when the backend reports it connected", () => {
    expect(connectionState("telegram", { telegram: true })).toBe("active");
    expect(connectionState("telegram", { telegram: false })).toBe("not-connected");
    expect(connectionState("telegram", {})).toBe("not-connected");
    expect(connectionState("telegram", null)).toBe("not-connected");
    expect(connectionState("telegram", undefined)).toBe("checking");
  });

  it("adapters the runtime does not have are never Active, whatever is reported", () => {
    for (const id of ["whatsapp", "discord", "slack", "x"] as const) {
      expect(connectionState(id, { [id]: true })).toBe("coming-soon");
      expect(connectionState(id, undefined)).toBe("coming-soon");
    }
  });

  it("labels", () => {
    expect(CONNECTION_LABEL.active).toBe("● Active");
    expect(CONNECTION_LABEL["not-connected"]).toBe("Not connected");
  });
});
