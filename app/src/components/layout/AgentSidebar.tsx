"use client";
import { useRouter } from "next/navigation";
import { Bot, Sparkles, UserPlus } from "lucide-react";
import { useApp, type Agent, type AgentStatus } from "@/context/AppContext";
import AgentSidebarRow from "@/components/agent/AgentSidebarRow";

const STATUS_ORDER: AgentStatus[] = ["online", "busy", "idle", "offline"];
const STATUS_LABEL: Record<AgentStatus, string> = {
  online: "Online", busy: "Busy", idle: "Idle", offline: "Offline",
};

export default function AgentSidebar() {
  const router = useRouter();
  const { activeServer, activeChannel } = useApp();
  const agents = activeServer?.agents ?? [];
  const showFlame = !!activeChannel && (activeChannel.messages?.length ?? 0) > 0;

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    const group = agents.filter(a => a.status === status);
    if (group.length) acc[status] = group;
    return acc;
  }, {} as Partial<Record<AgentStatus, Agent[]>>);

  const isEmpty = agents.length === 0;

  return (
    <aside className="w-64 flex flex-col flex-shrink-0 overflow-hidden" style={{ background: "var(--bf-secondary)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-14 border-b flex-shrink-0" style={{ borderColor: "var(--bf-quinary)" }}>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--bf-gray)" }}>
          Agents
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={{ background: "var(--bf-quinary)", color: "var(--bf-gray)" }}
          >
            {agents.length}
          </span>
          {!isEmpty && (
            <button
              onClick={() => router.push("/marketplace")}
              title="Invite an agent"
              className="w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:opacity-90"
              style={{ background: "var(--bf-quinary)", color: "var(--bf-gray)" }}
            >
              <UserPlus size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* Agent list */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-2 py-2"
        style={{
          background:
            "var(--bf-secondary)",
        }}
      >
        {isEmpty ? (
          <EmptyState onBrowse={() => router.push("/marketplace")} hasServer={!!activeServer} />
        ) : (
          STATUS_ORDER.map(status => {
            const group = grouped[status];
            if (!group) return null;
            return (
              <div key={status}>
                <p className="text-xs uppercase tracking-wide px-2 pt-5 pb-1.5 font-bold" style={{ color: "var(--bf-symbol)" }}>
                  {STATUS_LABEL[status]} — {group.length}
                </p>
                {group.map(agent => <AgentSidebarRow key={agent.id} agent={agent} />)}
              </div>
            );
          })
        )}
      </div>

      {showFlame && (
        <div className="flex-shrink-0 flex items-center justify-center pb-2 pointer-events-none">
        </div>
      )}
    </aside>
  );
}

function EmptyState({ onBrowse, hasServer }: { onBrowse: () => void; hasServer: boolean }) {
  return (
    <div className="flex flex-col items-center text-center mt-10 px-3">
      <div
        className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
      >
        <Bot size={28} strokeWidth={1.75} style={{ color: "var(--bf-gray)" }} />
        <span
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center"
          style={{ background: "var(--bf-accent)", color: "var(--on-ink)" }}
        >
          <Sparkles size={12} strokeWidth={2.5} />
        </span>
      </div>

      <h3 className="text-sm font-bold text-[var(--foreground)] mb-1.5">
        {hasServer ? "No agents yet" : "Pick a server first"}
      </h3>
      <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--bf-gray)" }}>
        {hasServer
          ? "Invite an agent from the marketplace to start delegating work in this server."
          : "Select or create a server to invite agents."}
      </p>

      {hasServer && (
        <>
          <button
            onClick={onBrowse}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg font-bold text-[var(--on-ink)] transition-opacity hover:opacity-90"
            style={{ background: "var(--bf-accent)", fontSize: 13 }}
          >
            <UserPlus size={14} strokeWidth={2.5} />
            Browse marketplace
          </button>

          <div className="mt-5 w-full pt-4 border-t" style={{ borderColor: "var(--bf-quinary)" }}>
            <p className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: "var(--bf-symbol)" }}>
              What can agents do?
            </p>
            <ul className="text-xs leading-relaxed space-y-1.5 text-left" style={{ color: "var(--bf-gray)" }}>
              <li>• Research, summarise, and cite sources</li>
              <li>• Write, review, and ship code</li>
              <li>• Read a photo of your notes and quiz you</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
