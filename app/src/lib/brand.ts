import { agentModelLabel } from "./agent-model-label";

/** App-wide BonFire mark (matches empty-state hero). */
export const BF_BRAND_EMOJI = "🔥";

/**
 * Model label shown for agents in the workspace sidebar. Not a hard-coded model name: the runtime picks
 * the real model from its env, so this names the service unless NEXT_PUBLIC_AGENT_MODEL_LABEL is set.
 */
export const BF_DISPLAY_AGENT_MODEL = agentModelLabel();
