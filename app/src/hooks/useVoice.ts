"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Participant {
  userId: string;
  userName: string;
  stream?: MediaStream;
}

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

function getWsUrl() {
  if (typeof window === "undefined") return "ws://localhost:8080/voice";
  const base = process.env.NEXT_PUBLIC_BONFIRE_BASE_URL ?? "http://localhost:8080";
  return base.replace(/^http/, "ws") + "/voice";
}

interface Conn {
  pc: RTCPeerConnection;
  userId: string;
  userName: string;
  stream?: MediaStream;
}

export function useVoice(channelId: string, selfId: string, selfName: string) {
  const [joined,       setJoined]       = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [muted,        setMuted]        = useState(false);
  const [deafened,     setDeafened]     = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const wsRef          = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const connsRef       = useRef<Map<string, Conn>>(new Map());
  // ICE candidates that arrived before remote description was set
  const iceBufRef      = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Use stable refs so callbacks don't go stale
  const selfIdRef   = useRef(selfId);
  const selfNameRef = useRef(selfName);
  const channelRef  = useRef(channelId);
  useEffect(() => { selfIdRef.current = selfId; }, [selfId]);
  useEffect(() => { selfNameRef.current = selfName; }, [selfName]);
  useEffect(() => { channelRef.current = channelId; }, [channelId]);

  // ── helpers ────────────────────────────────────────────────────────────────

  const rebuildParticipants = useCallback(() => {
    const list: Participant[] = [];
    const local = localStreamRef.current;
    if (local) list.push({ userId: selfIdRef.current, userName: selfNameRef.current, stream: local });
    for (const c of connsRef.current.values()) {
      list.push({ userId: c.userId, userName: c.userName, stream: c.stream });
    }
    setParticipants([...list]);
  }, []);

  const wsSend = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }, []);

  // ── create a peer connection ───────────────────────────────────────────────

  const createPc = useCallback((remoteId: string, remoteName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));

    pc.ontrack = (ev) => {
      const conn = connsRef.current.get(remoteId);
      if (conn) { conn.stream = ev.streams[0]; rebuildParticipants(); }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        wsSend({ type: "ice", channelId: channelRef.current, to: remoteId, from: selfIdRef.current, candidate: ev.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        connsRef.current.delete(remoteId);
        rebuildParticipants();
      }
    };

    if (!connsRef.current.has(remoteId)) {
      connsRef.current.set(remoteId, { pc, userId: remoteId, userName: remoteName });
    } else {
      connsRef.current.get(remoteId)!.pc = pc;
    }
    return pc;
  }, [wsSend, rebuildParticipants]);

  // ── join ──────────────────────────────────────────────────────────────────

  const join = useCallback(async () => {
    if (joined) return;
    setError(null);

    // Ensure we have a valid self ID (fall back to a temp one for guests)
    if (!selfIdRef.current) {
      selfIdRef.current = `guest-${Math.random().toString(36).slice(2, 8)}`;
    }

    // Get microphone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Mic error: ${msg}`);
      return;
    }
    localStreamRef.current = stream;

    // Open WebSocket
    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (e) {
      stream.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setError(`Cannot connect to voice server: ${e instanceof Error ? e.message : e}`);
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        channelId: channelRef.current,
        userId: selfIdRef.current,
        userName: selfNameRef.current || "Guest",
      }));
      setJoined(true);
      rebuildParticipants();
    };

    ws.onerror = () => {
      setError("Voice server connection failed. Is the backend running?");
      stream.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
      setJoined(false);
    };

    ws.onmessage = async (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data as string); } catch { return; }

      const type = msg.type as string;

      if (type === "peers") {
        // Existing peers — initiate offer to each
        for (const p of (msg.peers as { userId: string; userName: string }[])) {
          if (p.userId === selfIdRef.current) continue;
          const pc = createPc(p.userId, p.userName);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          wsSend({ type: "offer", channelId: channelRef.current, to: p.userId, from: selfIdRef.current, sdp: pc.localDescription });
        }
        rebuildParticipants();
        return;
      }

      if (type === "joined") {
        if ((msg.userId as string) !== selfIdRef.current) {
          createPc(msg.userId as string, (msg.userName as string) || (msg.userId as string));
          rebuildParticipants();
        }
        return;
      }

      if (type === "offer") {
        const from = msg.from as string;
        const conn = connsRef.current.get(from) ?? { pc: createPc(from, from), userId: from, userName: from };
        await conn.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        // Flush buffered ICE
        for (const c of (iceBufRef.current.get(from) ?? [])) await conn.pc.addIceCandidate(new RTCIceCandidate(c));
        iceBufRef.current.delete(from);
        const answer = await conn.pc.createAnswer();
        await conn.pc.setLocalDescription(answer);
        wsSend({ type: "answer", channelId: channelRef.current, to: from, from: selfIdRef.current, sdp: conn.pc.localDescription });
        return;
      }

      if (type === "answer") {
        const from = msg.from as string;
        const conn = connsRef.current.get(from);
        if (conn) await conn.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        return;
      }

      if (type === "ice") {
        const from = msg.from as string;
        const conn = connsRef.current.get(from);
        const candidate = msg.candidate as RTCIceCandidateInit;
        if (conn?.pc.remoteDescription) {
          await conn.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          // Buffer until remote description arrives
          const buf = iceBufRef.current.get(from) ?? [];
          buf.push(candidate);
          iceBufRef.current.set(from, buf);
        }
        return;
      }

      if (type === "left") {
        const uid = msg.userId as string;
        const conn = connsRef.current.get(uid);
        if (conn) { conn.pc.close(); connsRef.current.delete(uid); }
        rebuildParticipants();
        return;
      }
    };

    ws.onclose = () => {
      if (joined) setJoined(false);
    };
  }, [joined, createPc, wsSend, rebuildParticipants]);

  // ── leave ─────────────────────────────────────────────────────────────────

  const leave = useCallback(() => {
    wsSend({ type: "leave", channelId: channelRef.current, userId: selfIdRef.current });
    wsRef.current?.close();
    wsRef.current = null;
    for (const c of connsRef.current.values()) c.pc.close();
    connsRef.current.clear();
    iceBufRef.current.clear();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    setJoined(false);
    setParticipants([]);
    setError(null);
  }, [wsSend]);

  // ── mute / deafen ─────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !muted;
    stream.getAudioTracks().forEach(t => { t.enabled = !nextMuted; });
    setMuted(nextMuted);
  }, [muted]);

  const toggleDeafen = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    document.querySelectorAll<HTMLAudioElement>("audio[data-voice-peer]").forEach(el => { el.muted = next; });
  }, [deafened]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      for (const c of connsRef.current.values()) c.pc.close();
      connsRef.current.clear();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  return { joined, participants, muted, deafened, error, join, leave, toggleMute, toggleDeafen };
}
