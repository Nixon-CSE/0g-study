import type { ChannelAdapter, InboundMessage, TenantPayload } from './base.js';
import { EventEmitter } from 'node:events';

export interface WebChatBus {
  enqueue(userId: string, text: string, tenant?: string, envOverride?: Record<string, string>, tenantInline?: TenantPayload, studentId?: string): Promise<string>;
  subscribe(streamId: string, write: (chunk: string, done?: boolean) => void): () => void;
  finalize(streamId: string): void;
}

interface StreamState {
  write: (chunk: string, done?: boolean) => void;
  emitter: EventEmitter;
  finalChunk?: string;
  done: boolean;
  subscribed: boolean;
}

export class WebChatAdapter implements ChannelAdapter, WebChatBus {
  id = 'web';
  private handler?: (m: InboundMessage) => Promise<void>;
  private streams = new Map<string, StreamState>();

  async start(onMessage: (m: InboundMessage) => Promise<void>) { this.handler = onMessage; }
  async stop() { this.streams.clear(); }

  async enqueue(userId: string, text: string, tenant?: string, envOverride?: Record<string, string>, tenantInline?: TenantPayload, studentId?: string): Promise<string> {
    if (!this.handler) throw new Error('web adapter not started');
    const streamId = `${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const emitter = new EventEmitter();
    this.streams.set(streamId, { write: () => {}, emitter, done: false, subscribed: false });
    queueMicrotask(async () => {
      await this.handler!({
        channel: 'web',
        chatId: userId,
        userId,
        studentId,
        text,
        tenant,
        tenantInline,
        envOverride,
        reply: async (t) => {
          const s = this.streams.get(streamId);
          if (!s) return;
          s.done = true;
          if (s.subscribed) {
            s.write(t, true);
            s.emitter.emit('done');
          } else {
            // Hold the reply until a subscriber attaches.
            s.finalChunk = t;
          }
        },
        editLast: async (t) => { const s = this.streams.get(streamId); s?.write(`\x00REPLACE\x00${t}`); },
      });
    });
    return streamId;
  }

  subscribe(streamId: string, write: (chunk: string, done?: boolean) => void): () => void {
    const s = this.streams.get(streamId);
    if (!s) { write('error: no such stream', true); return () => {}; }
    s.write = write;
    s.subscribed = true;
    s.emitter.once('done', () => { this.streams.delete(streamId); });
    if (s.done && s.finalChunk !== undefined) {
      // Reply already arrived before subscribe; flush now and close.
      const chunk = s.finalChunk;
      s.finalChunk = undefined;
      queueMicrotask(() => { write(chunk, true); s.emitter.emit('done'); });
    }
    return () => { this.streams.delete(streamId); };
  }
  finalize(streamId: string) { this.streams.delete(streamId); }
}
