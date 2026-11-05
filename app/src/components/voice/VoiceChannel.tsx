"use client";
import { useEffect, useRef } from "react";
import { Mic, MicOff, Headphones, PhoneOff, Volume2 } from "lucide-react";
import { useVoice, type Participant } from "@/hooks/useVoice";
import { useApp } from "@/context/AppContext";
import Avatar from "@/components/shared/Avatar";

interface Props {
  channelId: string;
  channelName: string;
}

export default function VoiceChannel({ channelId, channelName }: Props) {
  const { user } = useApp();
  // Use a stable guest ID if user isn't authenticated yet
  const selfId   = user.id || "guest";
  const selfName = user.username || "Guest";

  const { joined, participants, muted, deafened, error, join, leave, toggleMute, toggleDeafen } =
    useVoice(channelId, selfId, selfName);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6" style={{ background: "var(--bf-primary)" }}>

      {/* Channel label */}
      <div className="flex items-center gap-2">
        <Volume2 size={20} style={{ color: "var(--bf-symbol)" }} strokeWidth={1.5} />
        <span className="text-[var(--foreground)] font-bold text-base">{channelName}</span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="w-full max-w-sm px-4 py-3 rounded-lg text-sm text-center"
          style={{ background: "rgba(240,71,71,0.18)", border: "1px solid var(--bf-red)", color: "#a8372f" }}>
          {error}
        </div>
      )}

      {!joined ? (
        /* ── Not connected ── */
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "var(--bf-quaternary)" }}>
            <Volume2 size={36} style={{ color: "var(--bf-gray)" }} strokeWidth={1} />
          </div>
          <p className="text-[var(--foreground)] font-semibold">Voice Channel</p>
          <p className="text-sm text-center max-w-xs" style={{ color: "var(--bf-gray)" }}>
            Click <strong style={{ color: "var(--foreground)" }}>Join Voice</strong> to start talking. Your browser will ask for microphone permission.
          </p>
          <button
            onClick={join}
            className="px-8 py-2.5 rounded-lg font-bold text-[var(--on-ink)] text-sm transition-opacity hover:opacity-90"
            style={{ background: "var(--bf-accent)" }}
          >
            Join Voice
          </button>
        </div>
      ) : (
        /* ── Connected ── */
        <div className="w-full max-w-2xl flex flex-col items-center gap-6 px-8">

          {/* Participant grid */}
          <div
            className="w-full grid gap-4"
            style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(participants.length, 1), 3)}, 1fr)` }}
          >
            {participants.map(p => (
              <ParticipantTile
                key={p.userId}
                participant={p}
                isSelf={p.userId === selfId}
                deafened={deafened}
              />
            ))}
          </div>

          {/* Control bar */}
          <div className="flex items-center gap-3 px-6 py-3 rounded-2xl" style={{ background: "var(--bf-quaternary)" }}>
            <VoiceBtn title={muted ? "Unmute" : "Mute"} danger={muted} onClick={toggleMute}>
              {muted ? <MicOff size={20} /> : <Mic size={20} />}
            </VoiceBtn>
            <VoiceBtn title={deafened ? "Undeafen" : "Deafen"} danger={deafened} onClick={toggleDeafen}>
              <Headphones size={20} />
            </VoiceBtn>
            <div style={{ width: 1, height: 28, background: "var(--bf-quinary)" }} />
            <VoiceBtn title="Disconnect" danger onClick={leave}>
              <PhoneOff size={20} />
            </VoiceBtn>
          </div>

          <p className="text-xs" style={{ color: "var(--bf-gray)" }}>
            {participants.length} participant{participants.length !== 1 ? "s" : ""} · {channelName}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Participant tile ──────────────────────────────────────────────────────────

function ParticipantTile({
  participant,
  isSelf,
  deafened,
}: {
  participant: Participant;
  isSelf: boolean;
  deafened: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !participant.stream || isSelf) return;
    el.srcObject = participant.stream;
    el.muted = deafened;
    el.play().catch(() => {});
  }, [participant.stream, isSelf, deafened]);

  return (
    <div
      className="flex flex-col items-center gap-3 p-5 rounded-2xl"
      style={{ background: "var(--bf-secondary)" }}
    >
      <Avatar name={participant.userName} size={64} />

      <p className="text-[var(--foreground)] text-sm font-semibold truncate max-w-full">
        {participant.userName}
        {isSelf && (
          <span className="ml-1 text-xs" style={{ color: "var(--bf-gray)" }}>(you)</span>
        )}
      </p>

      {!isSelf && (
        <audio
          ref={audioRef}
          autoPlay
          data-voice-peer={participant.userId}
          style={{ display: "none" }}
        />
      )}
    </div>
  );
}

// ── Control button ────────────────────────────────────────────────────────────

function VoiceBtn({
  children,
  title,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="w-10 h-10 rounded-full flex items-center justify-center transition-opacity hover:opacity-80"
      style={{ background: danger ? "var(--bf-red)" : "var(--bf-quinary)", color: "var(--on-ink)" }}
    >
      {children}
    </button>
  );
}
