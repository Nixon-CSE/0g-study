import { describe, it, expect } from "vitest";
import { agentModelLabel, profileModelLabel, DEFAULT_AGENT_MODEL_LABEL } from "../agent-model-label";

describe("agent model label", () => {
  it("names the service by default, never a hard-coded model", () => {
    expect(agentModelLabel(undefined)).toBe("0G Private Computer");
    expect(agentModelLabel("   ")).toBe(DEFAULT_AGENT_MODEL_LABEL);
    expect(agentModelLabel(undefined)).not.toMatch(/qwen|llama|gpt/i);
  });
  it("uses NEXT_PUBLIC_AGENT_MODEL_LABEL when set", () => {
    expect(agentModelLabel(" deepseek-v4.1-flash on 0G ")).toBe("deepseek-v4.1-flash on 0G");
  });
  it("profile prefers the model the backend reports, else the label", () => {
    expect(profileModelLabel("deepseek-v4.1-flash", undefined)).toBe("deepseek-v4.1-flash");
    expect(profileModelLabel(null, undefined)).toBe("0G Private Computer");
    expect(profileModelLabel("", "custom")).toBe("custom");
  });
});
