/**
 * Agent profile "Connections": only claim what is true. Telegram is "Active" only when the backend
 * reports the agent's Telegram bot really connected (GET /v1/agents/:aid/config → connections.telegram,
 * from the runtime's /status). Adapters the runtime doesn't have are "Coming soon".
 */
export type ConnectionId = "telegram" | "whatsapp" | "discord" | "slack" | "x";
export type ConnectionState = "active" | "not-connected" | "coming-soon" | "checking";
export type ReportedConnections = Partial<Record<ConnectionId, boolean>>;

/** Adapters the agent runtime actually implements. */
export const SUPPORTED_CONNECTIONS: ReadonlySet<ConnectionId> = new Set(["telegram"]);

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  active: "● Active",
  "not-connected": "Not connected",
  "coming-soon": "Coming soon",
  checking: "Checking…",
};

/**
 * `reported` is undefined while the profile is still loading, null when the backend couldn't say,
 * otherwise the backend's connections map.
 */
export function connectionState(id: ConnectionId, reported: ReportedConnections | null | undefined): ConnectionState {
  if (!SUPPORTED_CONNECTIONS.has(id)) return "coming-soon";
  if (reported === undefined) return "checking";
  return reported?.[id] === true ? "active" : "not-connected";
}
