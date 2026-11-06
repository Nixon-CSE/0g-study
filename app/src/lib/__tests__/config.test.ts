import { describe, it, expect } from "vitest";
import { browserAgentUrl } from "../config";

describe("browserAgentUrl", () => {
  const PUB = "https://agent.up.railway.app";
  it("a private Railway host becomes the public URL", () => {
    expect(browserAgentUrl("http://agent.railway.internal:7777", PUB)).toBe(PUB);
  });
  it("anything else is left alone", () => {
    expect(browserAgentUrl("https://other-agent.example", PUB)).toBe("https://other-agent.example");
    expect(browserAgentUrl("http://localhost:7777", PUB)).toBe("http://localhost:7777");
    expect(browserAgentUrl("not a url", PUB)).toBe("not a url");
  });
});
