"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useApp } from "@/context/AppContext";

export interface VoiceParticipant {
  userId: string;
  userName: string;
  stream?: MediaStream;
  isAgent?: boolean;
  emoji?: string;
  agentColor?: string;
  speaking?: boolean;
}

interface VoiceState {
  joinedChannelId: string | null;
  joinedChannelName: string | null;
  participants: VoiceParticipant[];
  muted: boolean;
  deafened: boolean;
  joining: boolean;
  error: string | null;
  join: (channelId: string, channelName: string) => Promise<void>;
  leave: () => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
  getStream: (userId: string) => MediaStream | undefined;
  inviteAgentToVoice: (agentId: string) => void;
  speakAsAgent: (agentId: string, text: string) => void;
}

const VoiceCtx = createContext<VoiceState | null>(null);

export function useVoiceCtx() {
  const ctx = useContext(VoiceCtx);
  if (!ctx) throw new Error("useVoiceCtx must be inside VoiceProvider");
  return ctx;
}

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];

function wsUrl() {
  if (typeof window === "undefined") return "ws://localhost:8080/voice";
  const base = process.env.NEXT_PUBLIC_BONFIRE_BASE_URL ?? "http://localhost:8080";
  return base.replace(/^http/, "ws") + "/voice";
}

interface Conn { pc: RTCPeerConnection; userId: string; userName: string; stream?: MediaStream; }

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useApp();

  const [joinedChannelId,   setJoinedChannelId]   = useState<string | null>(null);
  const [joinedChannelName, setJoinedChannelName] = useState<string | null>(null);
  const [participants,      setParticipants]       = useState<VoiceParticipant[]>([]);
  const [muted,             setMuted]              = useState(false);
  const [deafened,          setDeafened]           = useState(false);
  const [joining,           setJoining]            = useState(false);
  const [error,             setError]              = useState<string | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const localRef       = useRef<MediaStream | null>(null);
  const connsRef       = useRef<Map<string, Conn>>(new Map());
  const iceBufRef      = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const channelIdRef   = useRef<string | null>(null);
  const selfIdRef      = useRef<string>("");
  const selfNameRef    = useRef<string>("");
  const agentTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    selfIdRef.current   = user.id || `guest-${Math.random().toString(36).slice(2,8)}`;
    selfNameRef.current = user.username || "Guest";
  }, [user.id, user.username]);

  const rebuild = useCallback(() => {
    const list: VoiceParticipant[] = [];
    if (localRef.current) list.push({ userId: selfIdRef.current, userName: selfNameRef.current, stream: localRef.current });
    for (const c of connsRef.current.values()) list.push({ userId: c.userId, userName: c.userName, stream: c.stream });
    setParticipants([...list]);
  }, []);

  const wsSend = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  const makePc = useCallback((remoteId: string, remoteName: string): RTCPeerConnection => {
    const existing = connsRef.current.get(remoteId);
    if (existing) return existing.pc;

    const pc = new RTCPeerConnection({ iceServers: ICE });
    localRef.current?.getTracks().forEach(t => pc.addTrack(t, localRef.current!));

    pc.ontrack = ev => {
      const c = connsRef.current.get(remoteId);
      if (c) { c.stream = ev.streams[0]; rebuild(); }
    };
    pc.onicecandidate = ev => {
      if (ev.candidate) wsSend({ type: "ice", channelId: channelIdRef.current, to: remoteId, from: selfIdRef.current, candidate: ev.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        connsRef.current.delete(remoteId);
        rebuild();
      }
    };
    connsRef.current.set(remoteId, { pc, userId: remoteId, userName: remoteName });
    return pc;
  }, [wsSend, rebuild]);

  const leave = useCallback(() => {
    wsSend({ type: "leave", channelId: channelIdRef.current, userId: selfIdRef.current });
    wsRef.current?.close(); wsRef.current = null;
    for (const c of connsRef.current.values()) c.pc.close();
    connsRef.current.clear(); iceBufRef.current.clear();
    localRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null;
    channelIdRef.current = null;
    setJoinedChannelId(null); setJoinedChannelName(null);
    setParticipants([]); setMuted(false); setDeafened(false); setError(null);
  }, [wsSend]);

  const join = useCallback(async (channelId: string, channelName: string) => {
    // Already in this channel — no-op
    if (channelIdRef.current === channelId) return;
    // Leave previous channel first
    if (channelIdRef.current) leave();

    setJoining(true); setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      setError("Microphone access denied.");
      setJoining(false); return;
    }
    localRef.current = stream;
    channelIdRef.current = channelId;

    let ws: WebSocket;
    try { ws = new WebSocket(wsUrl()); }
    catch {
      stream.getTracks().forEach(t => t.stop()); localRef.current = null;
      channelIdRef.current = null;
      setError("Cannot reach voice server."); setJoining(false); return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", channelId, userId: selfIdRef.current, userName: selfNameRef.current }));
      setJoinedChannelId(channelId);
      setJoinedChannelName(channelName);
      setJoining(false);
      rebuild();
    };

    ws.onerror = () => {
      stream.getTracks().forEach(t => t.stop()); localRef.current = null;
      channelIdRef.current = null;
      setError("Voice server unreachable."); setJoining(false);
    };

    ws.onclose = () => { setJoinedChannelId(null); setJoinedChannelName(null); };

    ws.onmessage = async ev => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const type = msg.type as string;

      if (type === "peers") {
        for (const p of msg.peers as { userId: string; userName: string }[]) {
          if (p.userId === selfIdRef.current) continue;
          const pc = makePc(p.userId, p.userName);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend({ type: "offer", channelId, to: p.userId, from: selfIdRef.current, sdp: pc.localDescription });
        }
        rebuild(); return;
      }
      if (type === "joined" && (msg.userId as string) !== selfIdRef.current) {
        makePc(msg.userId as string, (msg.userName as string) || (msg.userId as string));
        rebuild(); return;
      }
      if (type === "offer") {
        const from = msg.from as string;
        const pc = makePc(from, from);
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        for (const c of iceBufRef.current.get(from) ?? []) await pc.addIceCandidate(new RTCIceCandidate(c));
        iceBufRef.current.delete(from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({ type: "answer", channelId, to: from, from: selfIdRef.current, sdp: pc.localDescription });
        return;
      }
      if (type === "answer") {
        const from = msg.from as string;
        const c = connsRef.current.get(from);
        if (c) await c.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        return;
      }
      if (type === "ice") {
        const from = msg.from as string;
        const c = connsRef.current.get(from);
        const candidate = msg.candidate as RTCIceCandidateInit;
        if (c?.pc.remoteDescription) await c.pc.addIceCandidate(new RTCIceCandidate(candidate));
        else { const buf = iceBufRef.current.get(from) ?? []; buf.push(candidate); iceBufRef.current.set(from, buf); }
        return;
      }
      if (type === "left") {
        const uid = msg.userId as string;
        const c = connsRef.current.get(uid);
        if (c) { c.pc.close(); connsRef.current.delete(uid); }
        rebuild(); return;
      }
    };
  }, [leave, makePc, wsSend, rebuild]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    localRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const toggleDeafen = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]").forEach(el => { el.muted = next; });
  }, [deafened]);

  const getStream = useCallback((userId: string) => {
    if (userId === selfIdRef.current) return localRef.current ?? undefined;
    return connsRef.current.get(userId)?.stream;
  }, []);

  // Add an agent as a virtual voice participant
  const inviteAgentToVoice = useCallback((agentId: string) => {
    const { activeServer } = (() => {
      // We can't call useApp here, so access via a closure trick is avoided.
      // Instead this is called by components that already have the agent data passed in.
      return { activeServer: null };
    })();
    void activeServer;
    setParticipants(prev => {
      if (prev.find(p => p.userId === agentId)) return prev;
      return [...prev, { userId: agentId, userName: agentId, isAgent: true, speaking: false }];
    });
  }, []);

  const speakAsAgent = useCallback((agentId: string, text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // Mark agent as speaking
    setParticipants(prev => prev.map(p => p.userId === agentId ? { ...p, speaking: true } : p));
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.0;
    utt.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.toLowerCase().includes("google") && v.lang.startsWith("en"));
    if (preferred) utt.voice = preferred;
    utt.onend = () => {
      setParticipants(prev => prev.map(p => p.userId === agentId ? { ...p, speaking: false } : p));
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utt);

    // Clear speaking after timeout safety net
    const existing = agentTimersRef.current.get(agentId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      setParticipants(prev => prev.map(p => p.userId === agentId ? { ...p, speaking: false } : p));
    }, Math.max(3000, text.length * 80));
    agentTimersRef.current.set(agentId, t);
  }, []);

  useEffect(() => () => { if (channelIdRef.current) leave(); }, [leave]);

  return (
    <VoiceCtx.Provider value={{ joinedChannelId, joinedChannelName, participants, muted, deafened, joining, error, join, leave, toggleMute, toggleDeafen, getStream, inviteAgentToVoice, speakAsAgent }}>
      {children}
    </VoiceCtx.Provider>
  );
}
