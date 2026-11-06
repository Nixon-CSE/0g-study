/**
 * What the UI says an agent runs on. The Study Pod's real models are chosen by the agent runtime's env
 * (ZEROG_LLM_MODEL / ZEROG_VISION_MODEL) and are not reported to the browser, so the default label names
 * the service instead of guessing a model: "0G Private Computer". Override with NEXT_PUBLIC_AGENT_MODEL_LABEL
 * (public — a display string only, never a key).
 */
export const DEFAULT_AGENT_MODEL_LABEL = "0G Private Computer";

export function agentModelLabel(envLabel: string | undefined = process.env.NEXT_PUBLIC_AGENT_MODEL_LABEL): string {
  const v = envLabel?.trim();
  return v ? v : DEFAULT_AGENT_MODEL_LABEL;
}

/** Profile modal: prefer the model the backend reports for this agent; otherwise the label. */
export function profileModelLabel(reported: string | null | undefined, envLabel?: string): string {
  const v = typeof reported === "string" ? reported.trim() : "";
  return v ? v : agentModelLabel(envLabel ?? process.env.NEXT_PUBLIC_AGENT_MODEL_LABEL);
}
