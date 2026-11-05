"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { MessageSquare, Plus, X } from "lucide-react";
import FlameAvatar from "@/components/shared/FlameAvatar";

export interface DmSession {
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentAvatar: string | null;
  agentBaseUrl: string;
  lastMessage: string;
  lastMessageAt: string;
}

const LS_DMS = "bonfire_dms";

export function getDmSessions(): DmSession[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_DMS) ?? "[]");
  } catch {
    return [];
  }
}

export function upsertDmSession(session: DmSession) {
  const sessions = getDmSessions().filter((s) => s.agentId !== session.agentId);
  const updated = [session, ...sessions];
  localStorage.setItem(LS_DMS, JSON.stringify(updated));
  return updated;
}

export function removeDmSession(agentId: string) {
  const updated = getDmSessions().filter((s) => s.agentId !== agentId);
  localStorage.setItem(LS_DMS, JSON.stringify(updated));
  return updated;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function AgentAvatar({ session, size = 36 }: { session: DmSession; size?: number }) {
  return (
    <FlameAvatar
      slug={session.agentSlug}
      avatarUrl={session.agentAvatar}
      size={size}
      alt={session.agentName}
    />
  );
}

export default function DmSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<DmSession[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessions(getDmSessions());

    function onStorage(e: StorageEvent) {
      if (e.key === LS_DMS) setSessions(getDmSessions());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Re-read on path change so list refreshes when returning from a DM
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessions(getDmSessions());
  }, [pathname]);

  function remove(e: React.MouseEvent, agentId: string) {
    e.stopPropagation();
    setSessions(removeDmSession(agentId));
  }

  return (
    <aside
      className="w-60 flex-shrink-0 flex flex-col border-r"
      style={{ background: "var(--bf-secondary)", borderColor: "var(--bf-quaternary)" }}
    >
      {/* Header */}
      <div
        className="px-4 h-12 border-b flex items-center justify-between"
        style={{ borderColor: "var(--bf-quaternary)" }}
      >
        <span className="font-bold" style={{ fontSize: 15, color: "var(--foreground)" }}>
          Direct Messages
        </span>
        <button
          onClick={() => router.push("/marketplace")}
          className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bf-quinary)] transition-colors"
          style={{ color: "var(--bf-gray)" }}
          title="Find an agent to message"
        >
          <Plus size={16} />
        </button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* DM list */}
        <div className="flex-1 overflow-y-auto px-2 pt-2 flex flex-col gap-0.5 min-h-0">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center py-10 px-4 gap-3 text-center">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--bf-quinary)" }}
              >
                <MessageSquare size={20} style={{ color: "var(--bf-gray)" }} />
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--bf-gray)" }}>
                No DMs yet. Browse the{" "}
                <button
                  onClick={() => router.push("/marketplace")}
                  className="underline hover:text-[var(--foreground)] transition-colors"
                >
                  marketplace
                </button>{" "}
                and message an agent.
              </p>
            </div>
          ) : (
            sessions.map((s) => {
              const isActive = pathname === `/dm/${s.agentId}`;
              return (
                <button
                  key={s.agentId}
                  onClick={() => router.push(`/dm/${s.agentId}`)}
                  className="group flex items-center gap-2.5 w-full px-2 py-2 rounded-md transition-colors text-left relative"
                  style={{
                    background: isActive ? "var(--bf-quinary)" : "transparent",
                    color: isActive ? "var(--foreground)" : "var(--bf-gray)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <AgentAvatar session={s} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span
                        className="text-sm font-semibold truncate"
                        style={{ color: isActive ? "var(--foreground)" : "var(--bf-text, white)" }}
                      >
                        {s.agentName}
                      </span>
                      <span className="text-xs flex-shrink-0 ml-1" style={{ color: "var(--bf-symbol)" }}>
                        {timeAgo(s.lastMessageAt)}
                      </span>
                    </div>
                    <p className="text-xs truncate" style={{ color: "var(--bf-gray)" }}>
                      {s.lastMessage || "Start a conversation"}
                    </p>
                  </div>
                  {/* Remove button */}
                  <button
                    onClick={(e) => remove(e, s.agentId)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--bf-quaternary)]"
                    style={{ color: "var(--bf-gray)" }}
                    title="Remove DM"
                  >
                    <X size={11} />
                  </button>
                </button>
              );
            })
          )}
        </div>

        <div
          className="flex-shrink-0 flex justify-center pb-3 pt-1"
          style={{ borderTop: "1px solid var(--bf-quaternary)" }}
        >
        </div>
      </div>
    </aside>
  );
}
