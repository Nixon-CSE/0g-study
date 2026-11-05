"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, UserPlus, X } from "lucide-react";
import type { DailyCall } from "@daily-co/daily-js";
import { DailyProvider, DailyAudio } from "@daily-co/daily-react";
import { voiceApi, type VoiceSession, type VoiceBot } from "@/lib/voice";
import VoiceParticipantTile from "./VoiceParticipantTile";
import { useVoiceCall } from "./useVoiceCall";
import InviteAgentModal from "./InviteAgentModal";
import { useApp } from "@/context/AppContext";

// ── Props ──────────────────────────────────────────────────────────────────

interface VoiceRoomProps {
  channelId: string;
  channelName: string;
  onClose(): void;
}

// ── Inner component that uses Daily hooks (must be inside DailyProvider) ───

function VoiceRoomInner({
  channelId,
  channelName,
  session,
  onClose,
}: VoiceRoomProps & { session: VoiceSession }) {
  const { joinState, participants, micMuted, toggleMic, deafened, toggleDeafen, leave, error } =
    useVoiceCall({ roomUrl: session.roomUrl, token: session.token });
  // Server-scoped agent list for the invite modal — only show agents that
  // are members of the active server, not the whole marketplace.
  const { activeServerId } = useApp();

  const didLeaveRef = useRef(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitedBots, setInvitedBots] = useState<VoiceBot[]>([]);
  const [kickingSlug, setKickingSlug] = useState<string | null>(null);

  // ── Status polling every 3s ────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await voiceApi.status(channelId);
        if (status.bots) {
          setInvitedBots(status.bots);
        }
      } catch {
        // best-effort — don't interrupt UX on poll failure
      }
    };

    poll(); // immediate first fetch
    const interval = setInterval(poll, 3_000);
    return () => clearInterval(interval);
  }, [channelId]);

  // ── beforeunload → best-effort beacon ─────────────────────────────────
  useEffect(() => {
    const handler = () => {
      if (didLeaveRef.current) return;
      const url = `${process.env.NEXT_PUBLIC_BONFIRE_BASE_URL ?? "http://localhost:8080"}/v1/channels/${channelId}/voice/leave`;
      navigator.sendBeacon(url, JSON.stringify({ sessionId: session.sessionId }));
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [channelId, session.sessionId]);

  const handleLeave = async () => {
    didLeaveRef.current = true;
    await leave();
    try {
      await voiceApi.leave(channelId, session.sessionId);
    } catch {
      // best-effort
    }
    onClose();
  };

  const handleKick = async (agentSlug: string) => {
    setKickingSlug(agentSlug);
    try {
      await voiceApi.kickAgent(channelId, { sessionId: session.sessionId, agentSlug });
      setInvitedBots((prev) => prev.filter((b) => b.agentSlug !== agentSlug));
    } catch {
      // best-effort — next poll will resync
    } finally {
      setKickingSlug(null);
    }
  };

  // ── Auto-close on transport error after brief delay ────────────────────
  useEffect(() => {
    if (joinState !== "error") return;
    const t = setTimeout(async () => {
      try { await voiceApi.leave(channelId, session.sessionId); } catch { /* ignore */ }
      onClose();
    }, 4_000);
    return () => clearTimeout(t);
  }, [joinState, channelId, session.sessionId, onClose]);

  const stateLabel =
    joinState === "joining"
      ? "Connecting…"
      : joinState === "leaving"
      ? "Disconnecting…"
      : joinState === "error"
      ? "Connection error"
      : null;

  const agentName = session.agentSlug ?? "BonFire Bot";

  const cols =
    participants.length <= 2 ? 2 : participants.length <= 4 ? 2 : 3;

  return (
    <>
    {/* DailyAudio renders <audio> elements for every remote participant so we
        can actually HEAR them. Without this, daily-react never plays remote
        audio (it doesn't auto-play remote tracks). Position absolutely off-screen. */}
    <DailyAudio />
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "rgba(17,18,20,0.97)" }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 h-14 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--bf-border)" }}
      >
        <div className="flex items-center gap-3">
          <Headphones size={18} style={{ color: "var(--bf-accent)" }} />
          <span className="text-[var(--on-ink)] font-bold text-sm">{channelName}</span>
          {session.agentSlug && (
            <>
              <span style={{ color: "var(--bf-symbol)" }}>·</span>
              <span className="text-sm" style={{ color: "var(--bf-accent)" }}>
                {agentName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {stateLabel && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--bf-quaternary)", color: joinState === "error" ? "var(--bf-red)" : "var(--bf-gray)" }}>
              {stateLabel}
            </span>
          )}
          {/* Invite Agent button */}
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ background: "var(--bf-quinary)", color: "var(--bf-white)" }}
            title="Invite an agent into this voice channel"
          >
            <UserPlus size={14} />
            <span>Invite Agent</span>
          </button>
        </div>
      </div>

      {/* ── Error toast ─────────────────────────────────────────────────── */}
      {error && (
        <div
          className="mx-6 mt-4 px-4 py-3 rounded-lg text-sm text-center"
          style={{
            background: "rgba(240,71,71,0.15)",
            border: "1px solid var(--bf-red)",
            color: "#a8372f",
          }}
        >
          {error} — closing in 4 s…
        </div>
      )}

      {/* ── Main content: participant grid + invited bots sidebar ────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Participant grid */}
        <div className="flex-1 flex items-center justify-center overflow-auto px-8 py-6">
          {participants.length === 0 ? (
            <div className="flex flex-col items-center gap-4">
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center"
                style={{ background: "var(--bf-quaternary)" }}
              >
                <Headphones size={36} style={{ color: "var(--bf-gray)" }} strokeWidth={1} />
              </div>
              <p className="text-[var(--foreground)] font-semibold">
                {joinState === "joining" ? "Connecting to voice channel…" : "You're alone in here"}
              </p>
              <p className="text-xs" style={{ color: "var(--bf-gray)" }}>
                {joinState === "joined" ? "Invite an agent to start the conversation." : ""}
              </p>
              <button
                onClick={() => setShowInviteModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold transition-opacity hover:opacity-80 mt-2"
                style={{ background: "var(--bf-quinary)", color: "var(--bf-white)" }}
              >
                <UserPlus size={16} />
                Invite Agent
              </button>
            </div>
          ) : (
            <div
              className="w-full max-w-3xl grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              }}
            >
              {participants.map((p) => (
                <VoiceParticipantTile
                  key={p.id}
                  participant={p}
                  onKick={
                    p.isAgent
                      ? () => handleKick(p.name.toLowerCase().replace(/\s+/g, "-"))
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Invited bots sidebar (shown when there are invited bots) ──── */}
        {invitedBots.length > 0 && (
          <div
            className="w-56 flex-shrink-0 flex flex-col overflow-hidden"
            style={{ borderLeft: "1px solid var(--bf-border)" }}
          >
            <div
              className="px-4 py-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--bf-border)" }}
            >
              <p
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--bf-gray)" }}
              >
                Invited Bots
              </p>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {invitedBots.map((bot) => (
                <div
                  key={bot.agentSlug}
                  className="flex items-center gap-2 px-3 py-2 group"
                >
                  {/* Bot avatar placeholder */}
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{
                      background: "var(--bf-accent)",
                      color: "var(--bf-white)",
                    }}
                  >
                    {bot.agentSlug.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--foreground)] font-medium truncate">
                      {bot.agentSlug}
                    </p>
                    <span
                      className="text-[10px] px-1 py-px rounded font-bold text-[var(--on-ink)] uppercase"
                      style={{ background: "var(--bf-accent)", fontSize: 9 }}
                    >
                      BOT
                    </span>
                  </div>
                  {/* Kick button */}
                  <button
                    onClick={() => handleKick(bot.agentSlug)}
                    disabled={kickingSlug === bot.agentSlug}
                    title={`Remove ${bot.agentSlug}`}
                    className="w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-80 disabled:opacity-30"
                    style={{ color: "var(--bf-red)" }}
                  >
                    {kickingSlug === bot.agentSlug ? (
                      <span
                        className="w-3 h-3 border border-t-transparent rounded-full animate-spin inline-block"
                        style={{ borderColor: "var(--bf-red)" }}
                      />
                    ) : (
                      <X size={12} />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom controls ──────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-center gap-4 py-5 flex-shrink-0"
        style={{ borderTop: "1px solid var(--bf-border)" }}
      >
        {/* Mute mic */}
        <button
          title={micMuted ? "Unmute microphone" : "Mute microphone"}
          aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
          aria-pressed={micMuted}
          onClick={toggleMic}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:opacity-90"
          style={{
            background: micMuted ? "var(--bf-red)" : "var(--bf-quinary)",
            color: "var(--on-ink)",
          }}
        >
          {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </button>

        {/* Deafen (mute incoming audio + force-mute mic) */}
        <button
          title={deafened ? "Undeafen (resume incoming audio)" : "Deafen (mute everyone)"}
          aria-label={deafened ? "Undeafen" : "Deafen"}
          aria-pressed={deafened}
          onClick={toggleDeafen}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-colors hover:opacity-90"
          style={{
            background: deafened ? "var(--bf-red)" : "var(--bf-quinary)",
            color: "var(--on-ink)",
          }}
        >
          {deafened ? <HeadphoneOff size={20} /> : <Headphones size={20} />}
        </button>

        {/* Leave */}
        <button
          title="Leave voice channel"
          aria-label="Leave voice channel"
          onClick={handleLeave}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-opacity hover:opacity-80 ml-2"
          style={{ background: "var(--bf-red)", color: "var(--on-ink)" }}
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>

    {/* ── Invite Agent Modal (z-60, overlays the room) ────────────────── */}
    {showInviteModal && (
      <InviteAgentModal
        channelId={channelId}
        sessionId={session.sessionId}
        serverId={activeServerId || undefined}
        onClose={() => setShowInviteModal(false)}
        onInvited={(slug) => {
          // Optimistically add to invited bots list; polling will confirm
          setInvitedBots((prev) => {
            if (prev.some((b) => b.agentSlug === slug)) return prev;
            return [
              ...prev,
              {
                agentSlug: slug,
                agentDocId: "",
                invitedAt: new Date().toISOString(),
              },
            ];
          });
          setShowInviteModal(false);
        }}
      />
    )}
    </>
  );
}

// ── Outer shell: fetch session, create call object, render provider ────────

export default function VoiceRoom({ channelId, channelName, onClose }: VoiceRoomProps) {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [callObject, setCallObject] = useState<DailyCall | null>(null);
  const didJoinRef = useRef(false);

  // Join API + create Daily call object
  useEffect(() => {
    if (didJoinRef.current) return;
    didJoinRef.current = true;

    let co: DailyCall | null = null;

    (async () => {
      try {
        // Create call object dynamically (must be client-side)
        const Daily = await import("@daily-co/daily-js");
        co = Daily.default.createCallObject();
        setCallObject(co);

        const sess = await voiceApi.join(channelId);
        setSession(sess);
      } catch (err) {
        setFetchError(
          err instanceof Error ? err.message : "Failed to join voice channel.",
        );
        if (co) co.destroy().catch(() => {});
      }
    })();

    return () => {
      // Cleanup on unmount if session not yet established
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── beforeunload beacon when session available ─────────────────────────
  useEffect(() => {
    if (!session) return;
    const handler = () => {
      const url = `${process.env.NEXT_PUBLIC_BONFIRE_BASE_URL ?? "http://localhost:8080"}/v1/channels/${channelId}/voice/leave`;
      navigator.sendBeacon(url, JSON.stringify({ sessionId: session.sessionId }));
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [session, channelId]);

  if (fetchError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(17,18,20,0.97)" }}>
        <div className="flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(240,71,71,0.15)", border: "1px solid var(--bf-red)", color: "#a8372f" }}>
            {fetchError}
          </div>
          <button onClick={onClose} className="px-6 py-2 rounded text-sm text-[var(--on-ink)]" style={{ background: "var(--bf-quinary)" }}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!session || !callObject) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(17,18,20,0.97)" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--bf-accent)" }} />
          <p className="text-sm" style={{ color: "var(--bf-gray)" }}>Connecting…</p>
        </div>
      </div>
    );
  }

  return (
    <DailyProvider callObject={callObject}>
      <VoiceRoomInner
        channelId={channelId}
        channelName={channelName}
        session={session}
        onClose={async () => {
          onClose();
          // Destroy call object after modal closes
          setTimeout(() => callObject.destroy().catch(() => {}), 500);
        }}
      />
    </DailyProvider>
  );
}
