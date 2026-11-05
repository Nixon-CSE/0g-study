"use client";

import { Mic, MicOff, X } from "lucide-react";
import Avatar from "@/components/shared/Avatar";
import type { VoiceParticipantInfo } from "./useVoiceCall";

interface Props {
  participant: VoiceParticipantInfo;
  /** Called when the user clicks the kick button on a bot tile. Only rendered when provided. */
  onKick?: () => void;
}

export default function VoiceParticipantTile({ participant, onKick }: Props) {
  const { name, isLocal, isAgent, audioLevel, muted } = participant;
  const isSpeaking = audioLevel > 0.01;

  return (
    <div className="relative flex flex-col items-center gap-3 p-5 rounded-2xl select-none group"
      style={{ background: "var(--bf-secondary)" }}>

      {/* Kick button — top-right corner, only for bot tiles when onKick is provided */}
      {isAgent && onKick && (
        <button
          onClick={onKick}
          title="Remove bot"
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-80"
          style={{ background: "var(--bf-quinary)", color: "var(--bf-red)" }}
        >
          <X size={12} />
        </button>
      )}

      {/* Avatar with speaking pulse ring */}
      <div className="relative">
        {/* Outer pulse ring — only visible when speaking */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full transition-all duration-150 pointer-events-none"
          style={{
            boxShadow: isSpeaking
              ? "0 0 0 3px var(--bf-accent)"
              : "0 0 0 3px transparent",
            borderRadius: "50%",
          }}
        />
        {/* Avatar circle */}
        <div
          className="rounded-full overflow-hidden"
          style={{
            border: isAgent
              ? "2px solid var(--bf-accent)"
              : "2px solid transparent",
          }}
        >
          <Avatar name={name} size={64} />
        </div>
      </div>

      {/* Name row */}
      <div className="flex items-center gap-1.5 max-w-full">
        <span
          className="text-[var(--foreground)] text-sm font-semibold truncate"
          style={{ maxWidth: 120 }}
        >
          {name}
        </span>
        {isLocal && (
          <span className="text-xs flex-shrink-0" style={{ color: "var(--bf-gray)" }}>
            (you)
          </span>
        )}
        {isAgent && (
          <span
            className="text-xs px-1 py-px rounded font-bold text-[var(--on-ink)] uppercase flex-shrink-0"
            style={{ background: "var(--bf-accent)", fontSize: 9 }}
          >
            BOT
          </span>
        )}
      </div>

      {/* Mute indicator */}
      <div>
        {muted ? (
          <MicOff size={14} style={{ color: "var(--bf-red)" }} />
        ) : (
          <Mic
            size={14}
            style={{ color: isSpeaking ? "var(--bf-accent)" : "var(--bf-symbol)" }}
          />
        )}
      </div>
    </div>
  );
}
