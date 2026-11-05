"use client";
import { useState } from "react";
import type { Agent } from "@/context/AppContext";
import FlameAvatar from "@/components/shared/FlameAvatar";
import AgentProfileModal from "./AgentProfileModal";

const STATUS_COLOR: Record<string, string> = {
  online:  "var(--bf-accent)",
  busy:    "#a8372f",
  idle:    "#7a5013",
  offline: "#4b5563",
};

export default function AgentSidebarRow({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-3 w-full px-2 py-2 rounded-lg text-left group transition-colors"
        style={{ color: "var(--bf-gray)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "var(--bf-quinary)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      >
        {/* Avatar with presence ring */}
        <div className="relative flex-shrink-0">
          <FlameAvatar
            slug={agent.slug || agent.id}
            avatarUrl={agent.avatar}
            size={36}
            alt={agent.name}
          />
          {/* Presence dot — circle with white border, positioned bottom-right */}
          <span
            className="absolute rounded-full"
            style={{
              width: 11,
              height: 11,
              background: STATUS_COLOR[agent.status] ?? "#4b5563",
              border: "2px solid var(--bf-secondary)",
              bottom: -1,
              right: -1,
            }}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--foreground)] font-semibold truncate leading-tight">{agent.name}</p>
          <p className="text-xs truncate capitalize leading-tight mt-0.5" style={{ color: "var(--bf-gray)" }}>
            {agent.model ?? agent.status}
          </p>
        </div>

        <span
          className="text-[var(--on-ink)] font-bold uppercase flex-shrink-0"
          style={{ fontSize: 9, background: "var(--bf-accent)", padding: "2px 5px", borderRadius: 4, letterSpacing: "0.05em" }}
        >
          BOT
        </span>
      </button>

      {open && <AgentProfileModal agent={agent} onClose={() => setOpen(false)} />}
    </>
  );
}
