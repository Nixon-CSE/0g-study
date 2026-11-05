"use client";

import { useEffect, useRef, useState } from "react";
import { X, UserPlus, Search } from "lucide-react";
import { bf } from "@/lib/api-bonfire";
import { voiceApi } from "@/lib/voice";
import type { BackendAgent } from "@/lib/types";
import FlameAvatar from "@/components/shared/FlameAvatar";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  channelId: string;
  sessionId: string;
  /**
   * Server the voice room belongs to. When provided, the modal lists only
   * agents that are members of this server (text-channel sidebar list).
   * Falls back to "all marketplace agents" when omitted so the modal still
   * works in legacy contexts.
   */
  serverId?: string;
  onClose(): void;
  onInvited(agentSlug: string): void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InviteAgentModal({
  channelId,
  sessionId,
  serverId,
  onClose,
  onInvited,
}: Props) {
  const [agents, setAgents] = useState<BackendAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Per-agent invite state: slug → "idle" | "inviting" | "success" | error string
  const [inviteState, setInviteState] = useState<Record<string, string>>({});

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch agent list once
  const didFetch = useRef(false);
  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;

    (async () => {
      try {
        // Pull the marketplace list (full BackendAgent metadata) AND, when we
        // have a serverId, the server's agent members. The intersection by
        // principalId is the invite list — only agents already added to this
        // server show up.
        const [{ agents: marketplace }, memberSet] = await Promise.all([
          bf.listAgents({ limit: 100 }),
          serverId
            ? bf.listMembers(serverId, "agent")
                .then((r) => new Set(r.members.map((m) => m.principalId)))
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        const filtered =
          memberSet !== null
            ? marketplace.filter((a) => memberSet.has(a.id))
            : marketplace;
        setAgents(filtered);
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : "Failed to load agents.",
        );
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  // Filtered list
  const filtered = query.trim()
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.slug.toLowerCase().includes(query.toLowerCase()) ||
          a.description.toLowerCase().includes(query.toLowerCase()),
      )
    : agents;

  const handleInvite = async (agent: BackendAgent) => {
    const slug = agent.slug;
    setInviteState((prev) => ({ ...prev, [slug]: "inviting" }));
    try {
      await voiceApi.inviteAgent(channelId, { sessionId, agentSlug: slug });
      setInviteState((prev) => ({ ...prev, [slug]: "success" }));
      onInvited(slug);
    } catch (err) {
      let msg = "Invite failed";
      if (err instanceof Error) {
        if (err.message.includes("agent_not_invitable")) {
          msg = "Agent not invitable";
        } else if (err.message.includes("agent_already_in_room")) {
          msg = "Already in room";
        } else {
          msg = err.message;
        }
      }
      setInviteState((prev) => ({ ...prev, [slug]: msg }));
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      {/* Panel */}
      <div
        className="w-[520px] max-w-[95vw] rounded-xl flex flex-col"
        style={{
          background: "var(--bf-primary)",
          maxHeight: "85vh",
          border: "1px solid var(--bf-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--bf-border)" }}
        >
          <div className="flex items-center gap-2">
            <UserPlus size={18} style={{ color: "var(--bf-accent)" }} />
            <h2 className="text-[var(--on-ink)] font-bold text-base">Invite Agent</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:opacity-70 transition-opacity"
            style={{ color: "var(--bf-gray)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4 pb-2 flex-shrink-0">
          <div
            className="flex items-center gap-2 rounded px-3 py-2"
            style={{
              background: "var(--bf-quaternary)",
              border: "1px solid transparent",
            }}
          >
            <Search size={14} style={{ color: "var(--bf-gray)" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents…"
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--bf-symbol)] focus:outline-none"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-2">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div
                className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: "var(--bf-accent)" }}
              />
            </div>
          )}

          {!loading && fetchError && (
            <div
              className="rounded p-3 text-sm text-center mt-4"
              style={{
                background: "rgba(240,71,71,0.12)",
                border: "1px solid var(--bf-red)",
                color: "#a8372f",
              }}
            >
              {fetchError}
            </div>
          )}

          {!loading && !fetchError && filtered.length === 0 && (
            <p
              className="text-sm text-center py-12"
              style={{ color: "var(--bf-gray)" }}
            >
              {query ? "No agents match your search." : "No agents available."}
            </p>
          )}

          {!loading && !fetchError && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-3 mt-1">
              {filtered.map((agent) => {
                const state = inviteState[agent.slug] ?? "idle";
                const isInviting = state === "inviting";
                const isSuccess = state === "success";
                const hasError =
                  state !== "idle" && state !== "inviting" && state !== "success";

                return (
                  <div
                    key={agent.id}
                    className="flex items-center gap-4 rounded-lg p-4"
                    style={{ background: "var(--bf-secondary)" }}
                  >
                    {/* Avatar */}
                    <FlameAvatar
                      slug={agent.slug}
                      avatarUrl={agent.avatarUrl}
                      size={44}
                      alt={agent.name}
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--foreground)] text-sm font-semibold truncate">
                        {agent.name}
                      </p>
                      <p
                        className="text-xs truncate"
                        style={{ color: "var(--bf-symbol)" }}
                      >
                        @{agent.slug}
                      </p>
                      <p
                        className="text-xs mt-0.5 line-clamp-2"
                        style={{ color: "var(--bf-gray)" }}
                      >
                        {agent.description}
                      </p>
                      {hasError && (
                        <p className="text-xs mt-1" style={{ color: "var(--bf-red)" }}>
                          {state}
                        </p>
                      )}
                    </div>

                    {/* Invite button */}
                    <button
                      onClick={() => handleInvite(agent)}
                      disabled={isInviting || isSuccess}
                      className="px-4 py-1.5 rounded text-xs font-semibold flex-shrink-0 transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-default"
                      style={{
                        background: isSuccess
                          ? "var(--bf-accent)"
                          : "var(--bf-fire, var(--bf-accent))",
                        color: isSuccess ? "var(--on-ink)" : "var(--bf-white)",
                        minWidth: 72,
                      }}
                    >
                      {isInviting ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <span
                            className="w-3 h-3 border border-t-transparent rounded-full animate-spin inline-block"
                            style={{ borderColor: "rgba(255,255,255,0.8)" }}
                          />
                        </span>
                      ) : isSuccess ? (
                        "Invited!"
                      ) : (
                        "Invite"
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
