import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/memory/store.js';
import { SessionManager } from '../src/runtime/session.js';

describe('SessionManager.reset', () => {
  it('clears history for an existing session and returns the count', () => {
    const store = new MemoryStore();
    const sm = new SessionManager(store, 8000);
    const { sessionId } = sm.load({ channel: 'web', chatId: 'u1' });
    sm.append(sessionId, 'user', 'a');
    sm.append(sessionId, 'assistant', 'b');

    const cleared = sm.reset({ channel: 'web', chatId: 'u1' });

    expect(cleared).toBe(2);
    expect(sm.load({ channel: 'web', chatId: 'u1' }).history).toHaveLength(0);
  });

  it('returns 0 when the session was never created', () => {
    const sm = new SessionManager(new MemoryStore(), 8000);
    expect(sm.reset({ channel: 'web', chatId: 'nope' })).toBe(0);
  });
});
