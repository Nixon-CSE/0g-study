import type { AgentDoc, ChannelDoc, MessageDoc } from '../db/types.js';

export interface PendingStream {
  streamId: string;
  channel: ChannelDoc;
  agent: AgentDoc;
  userMessage: MessageDoc;
  upstreamUrl: string;
  createdAt: number;
  onClose: (finalText: string) => Promise<void>;
}

const STREAMS = new Map<string, PendingStream>();
const TTL_MS = 5 * 60_000;

export function registerStream(s: PendingStream): void {
  STREAMS.set(s.streamId, s);
  setTimeout(() => STREAMS.delete(s.streamId), TTL_MS).unref?.();
}

export function takeStream(streamId: string): PendingStream | undefined {
  const s = STREAMS.get(streamId);
  STREAMS.delete(streamId);
  return s;
}
