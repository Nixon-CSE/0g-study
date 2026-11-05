import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/memory/store.js';

// Pure in-memory store (no filePath => no persistence).
const mkVec = (n: number) => Float32Array.from({ length: 4 }, () => n);

describe('MemoryStore reset + stats', () => {
  it('findSession returns null when absent and the id once created', () => {
    const s = new MemoryStore();
    expect(s.findSession('web', 'u1')).toBeNull();
    const id = s.getOrCreateSession('web', 'u1');
    expect(s.findSession('web', 'u1')).toBe(id);
  });

  it('clearSession removes only that session\'s messages + vectors and returns the count', () => {
    const s = new MemoryStore();
    const a = s.getOrCreateSession('web', 'a');
    const b = s.getOrCreateSession('web', 'b');
    s.appendMessage(a, 'user', 'hi');
    s.appendMessage(a, 'assistant', 'hello');
    s.indexVector(a, 'r1', 'snippet-a', mkVec(1));
    s.appendMessage(b, 'user', 'keep me');

    const cleared = s.clearSession(a);

    expect(cleared).toBe(2);
    expect(s.countMessages(a)).toBe(0);
    expect(s.countMessages(b)).toBe(1);
    // session row survives — same id is returned, not a new one
    expect(s.getOrCreateSession('web', 'a')).toBe(a);
    // vectors for a are gone, so a search cannot return its snippet
    expect(s.searchVectors(mkVec(1), 5).some(h => h.ref === 'r1')).toBe(false);
  });

  it('clearSession on an unknown session clears nothing and returns 0', () => {
    const s = new MemoryStore();
    expect(s.clearSession(999)).toBe(0);
  });

  it('stats reports sessions, messages and vectors totals', () => {
    const s = new MemoryStore();
    const a = s.getOrCreateSession('web', 'a');
    s.appendMessage(a, 'user', 'x');
    s.indexVector(a, 'r', 'snip', mkVec(1));
    expect(s.stats()).toEqual({ sessions: 1, messages: 1, vectors: 1 });
  });
});
