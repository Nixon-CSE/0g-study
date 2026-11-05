"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useDaily,
  useDailyEvent,
  useParticipantIds,
  useParticipant,
  useActiveSpeakerId,
} from "@daily-co/daily-react";

export interface VoiceParticipantInfo {
  id: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  audioLevel: number;
  muted: boolean;
}

export interface UseVoiceCall {
  joinState: "idle" | "joining" | "joined" | "leaving" | "error";
  participants: VoiceParticipantInfo[];
  micMuted: boolean;
  toggleMic(): void;
  deafened: boolean;
  toggleDeafen(): void;
  leave(): Promise<void>;
  error: string | null;
}

// The hook is used inside a component that is already wrapped in DailyProvider
// so we can call Daily hooks here directly.
export function useVoiceCall(opts: {
  roomUrl: string;
  token: string;
}): UseVoiceCall {
  const callObject = useDaily();
  const participantIds = useParticipantIds();
  const activeSpeakerId = useActiveSpeakerId();

  const [joinState, setJoinState] = useState<UseVoiceCall["joinState"]>("idle");
  const [micMuted, setMicMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track audio levels per session id
  const [audioLevels, setAudioLevels] = useState<Record<string, number>>({});

  const joinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didJoinRef = useRef(false);

  // ── Join on mount (fire-and-forget, no synchronous setState in effect) ─────
  useEffect(() => {
    if (!callObject || !opts.roomUrl || !opts.token) return;
    if (didJoinRef.current) return;
    didJoinRef.current = true;

    joinTimeoutRef.current = setTimeout(() => {
      setJoinState("error");
      setError("Connection timed out. Please try again.");
      callObject.leave().catch(() => {});
    }, 10_000);

    // Set joining state via queueMicrotask to avoid synchronous setState in effect
    queueMicrotask(() => setJoinState("joining"));

    callObject
      .join({
        url: opts.roomUrl,
        token: opts.token,
        // Audio-only — never request the camera; never publish video.
        videoSource: false,
        audioSource: true,
        subscribeToTracksAutomatically: true,
      })
      .catch((err: unknown) => {
        if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
        setJoinState("error");
        setError(err instanceof Error ? err.message : "Failed to join voice channel.");
      });

    return () => {
      if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
    };
    // Only run once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callObject]);

  // ── Daily event handlers (callbacks — not synchronous effect setState) ──────

  useDailyEvent("joined-meeting", () => {
    if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
    setJoinState("joined");
  });

  useDailyEvent("left-meeting", () => {
    setJoinState("idle");
  });

  useDailyEvent("error", (ev) => {
    if (joinTimeoutRef.current) clearTimeout(joinTimeoutRef.current);
    setJoinState("error");
    const msg = (ev as { errorMsg?: string }).errorMsg ?? "Daily transport error.";
    setError(msg);
  });

  useDailyEvent("nonfatal-error", (ev) => {
    console.warn("[Daily non-fatal]", ev);
  });

  // ── Active speaker → audio level via Daily event (callback, not effect) ─────
  useDailyEvent("active-speaker-change", (ev) => {
    const peerId = (ev as { activeSpeaker?: { peerId?: string } }).activeSpeaker?.peerId;
    if (!peerId) return;
    setAudioLevels((prev) => ({ ...prev, [peerId]: 0.5 }));
    setTimeout(() => {
      setAudioLevels((prev) => ({ ...prev, [peerId]: 0 }));
    }, 300);
  });

  // Keep activeSpeakerId in sync for tiles (also used as fallback indicator)
  const currentSpeaker = activeSpeakerId;

  // ── Build participant list ─────────────────────────────────────────────────
  const ParticipantList = useParticipantListData(participantIds, audioLevels, currentSpeaker);

  // ── Mic toggle ────────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    if (!callObject) return;
    const next = !micMuted;
    callObject.setLocalAudio(!next);
    setMicMuted(next);
    // Un-deafening implicitly unmutes the mic; deafening also mutes the mic
    // (standard Discord behavior — you can't deafen and still talk).
  }, [callObject, micMuted]);

  // ── Deafen toggle (mute incoming audio + force mic mute) ──────────────────
  const toggleDeafen = useCallback(() => {
    if (!callObject) return;
    const next = !deafened;
    setDeafened(next);
    if (next) {
      // Going deaf → mute mic too (Discord convention)
      if (!micMuted) {
        callObject.setLocalAudio(false);
        setMicMuted(true);
      }
      // Unsubscribe from every remote participant's audio track.
      try {
        const remoteUpdates: Record<string, { setSubscribedTracks: { audio: boolean } }> = {};
        for (const id of participantIds) {
          remoteUpdates[id] = { setSubscribedTracks: { audio: false } };
        }
        if (Object.keys(remoteUpdates).length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (callObject as any).updateParticipants(remoteUpdates);
        }
      } catch { /* daily-js shape variance — best effort */ }
    } else {
      // Re-subscribe to remote audio. Mic stays whatever the user explicitly set.
      try {
        const remoteUpdates: Record<string, { setSubscribedTracks: { audio: boolean } }> = {};
        for (const id of participantIds) {
          remoteUpdates[id] = { setSubscribedTracks: { audio: true } };
        }
        if (Object.keys(remoteUpdates).length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (callObject as any).updateParticipants(remoteUpdates);
        }
      } catch { /* best effort */ }
    }
  }, [callObject, deafened, micMuted, participantIds]);

  // ── Leave ─────────────────────────────────────────────────────────────────
  const leave = useCallback(async () => {
    if (!callObject) return;
    setJoinState("leaving");
    try {
      await callObject.leave();
    } catch {
      // ignore
    }
    setJoinState("idle");
  }, [callObject]);

  return {
    joinState,
    participants: ParticipantList,
    micMuted,
    toggleMic,
    deafened,
    toggleDeafen,
    leave,
    error,
  };
}

// ── Helper hook: build participant info for all ids ────────────────────────

function useParticipantListData(
  ids: string[],
  audioLevels: Record<string, number>,
  activeSpeakerId: string | null,
): VoiceParticipantInfo[] {
  // We use a flat hook pattern — call useParticipant for each slot.
  // React hooks cannot be called conditionally or in loops,
  // so we pre-allocate a fixed number of slots (caps at 12 participants).
  const p0  = useParticipant(ids[0]  ?? "");
  const p1  = useParticipant(ids[1]  ?? "");
  const p2  = useParticipant(ids[2]  ?? "");
  const p3  = useParticipant(ids[3]  ?? "");
  const p4  = useParticipant(ids[4]  ?? "");
  const p5  = useParticipant(ids[5]  ?? "");
  const p6  = useParticipant(ids[6]  ?? "");
  const p7  = useParticipant(ids[7]  ?? "");
  const p8  = useParticipant(ids[8]  ?? "");
  const p9  = useParticipant(ids[9]  ?? "");
  const p10 = useParticipant(ids[10] ?? "");
  const p11 = useParticipant(ids[11] ?? "");

  const raw = [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11];

  return raw
    .map((p, i) => {
      if (!p || !ids[i]) return null;
      const isAgent =
        p.user_name === "BonFire Bot" || p.owner === true;
      const audioMuted =
        p.tracks?.audio?.state === "off" ||
        p.tracks?.audio?.state === "interrupted" ||
        p.audio === false;
      const level =
        audioLevels[p.session_id] ??
        (activeSpeakerId === p.session_id ? 0.3 : 0);
      return {
        id: p.session_id,
        name: p.user_name || "Anonymous",
        isLocal: p.local,
        isAgent,
        audioLevel: level,
        muted: audioMuted,
      } satisfies VoiceParticipantInfo;
    })
    .filter((p): p is VoiceParticipantInfo => p !== null);
}
