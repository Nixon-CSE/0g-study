import type { MemoryStore } from '../memory/store.js';
import type { CoreMessage } from 'ai';

export interface SessionKey { channel: string; chatId: string; topic?: string; }

export class SessionManager {
  constructor(private store: MemoryStore, private compactAfter: number) {}

  load(key: SessionKey): { sessionId: number; history: CoreMessage[] } {
    const sid = this.store.getOrCreateSession(key.channel, key.chatId, key.topic ?? '');
    const msgs = this.store.recentMessages(sid, 200);
    const history: CoreMessage[] = msgs.map(m => ({ role: m.role as any, content: m.content }));
    return { sessionId: sid, history };
  }

  append(sessionId: number, role: 'user' | 'assistant' | 'tool' | 'system', content: string) {
    this.store.appendMessage(sessionId, role, content);
  }

  /** Clear the conversation for a session. Returns the number of messages removed (0 if unknown). */
  reset(key: SessionKey): number {
    const sid = this.store.findSession(key.channel, key.chatId, key.topic ?? '');
    if (sid === null) return 0;
    return this.store.clearSession(sid);
  }

  maybeCompact(sessionId: number, tokenEstimate: number) {
    if (tokenEstimate < this.compactAfter) return;
    const total = this.store.countMessages(sessionId);
    if (total > 40) this.store.deleteOldMessages(sessionId, 20);
  }
}
