import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../src/memory/store.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.resolve(__dirname, '.tmp-mem.json');

describe('MemoryStore', () => {
  beforeEach(() => { try { fs.unlinkSync(tmp); } catch {} });

  it('persists session messages', () => {
    const m = new MemoryStore(tmp, 8);
    const sid = m.getOrCreateSession('web', 'u1');
    m.appendMessage(sid, 'user', 'hello');
    m.appendMessage(sid, 'assistant', 'hi');
    const msgs = m.recentMessages(sid, 10);
    expect(msgs.length).toBe(2);
    expect(msgs[0].content).toBe('hello');
    m.close();
  });

  it('vector search returns inserted vector', () => {
    const m = new MemoryStore(tmp, 8);
    const sid = m.getOrCreateSession('web', 'u1');
    const vec = new Float32Array(8).fill(0); vec[0] = 1;
    m.indexVector(sid, 'msg-1', 'hello world', vec);
    const hits = m.searchVectors(vec, 5);
    expect(hits.length).toBeGreaterThan(0);
    m.close();
  });

  it('reloads state from snapshot file', () => {
    const a = new MemoryStore(tmp, 8);
    const sid = a.getOrCreateSession('web', 'u1');
    a.appendMessage(sid, 'user', 'persist me');
    const vec = new Float32Array(8).fill(0); vec[0] = 1;
    a.indexVector(sid, 'msg-1', 'persist me', vec);
    a.close();

    expect(fs.existsSync(tmp)).toBe(true);
    const b = new MemoryStore(tmp, 8);
    const sid2 = b.getOrCreateSession('web', 'u1');
    expect(sid2).toBe(sid);
    const msgs = b.recentMessages(sid2, 10);
    expect(msgs.map(m => m.content)).toEqual(['persist me']);
    expect(b.searchVectors(vec, 5).length).toBe(1);
    b.close();
  });
});
