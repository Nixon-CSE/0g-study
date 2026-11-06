/** Empty-channel hint: only suggest inviting an agent when the server has none. */
export const EMPTY_NO_AGENTS = "This is the start of this channel. Invite an agent to get going.";
export const EMPTY_WITH_AGENTS = "Attach a notes photo with + and mention @study-note-reader to start.";

export function emptyChannelHint(agentCount: number | undefined): string {
  return agentCount && agentCount > 0 ? EMPTY_WITH_AGENTS : EMPTY_NO_AGENTS;
}
