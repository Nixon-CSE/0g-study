import type { AgentStatus } from "@/context/AppContext";

const COLORS: Record<AgentStatus, string> = {
  online:  "var(--bf-accent)",
  busy:    "#a8372f",
  idle:    "#7a5013",
  offline: "#747f8d",
};

const LABELS: Record<AgentStatus, string> = {
  online:  "Online",
  busy:    "Busy",
  idle:    "Idle",
  offline: "Offline",
};

export default function PresenceDot({ status, size = 10 }: { status: AgentStatus; size?: number }) {
  return (
    <span
      title={LABELS[status]}
      style={{ width: size, height: size, background: COLORS[status] }}
      className="rounded-full inline-block flex-shrink-0"
    />
  );
}
