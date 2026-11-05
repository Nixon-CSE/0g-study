import fs from 'node:fs';
import path from 'node:path';

export interface Message {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  created_at: number;
}

interface VectorEntry {
  rowid: number;
  session_id: number;
  ref: string;
  snippet: string;
  vec: number[];
}

interface Snapshot {
  v: 1;
  vecDim: number;
  nextSessionId: number;
  nextMessageId: number;
  nextVectorRowid: number;
  sessions: Array<{ id: number; channel: string; chat_id: string; topic: string; created_at: number }>;
  messages: Message[];
  vectors: VectorEntry[];
}

const FLUSH_DEBOUNCE_MS = 250;

export class MemoryStore {
  private vecDim: number;
  private filePath: string | null;
  private sessions: Snapshot['sessions'] = [];
  private messages: Message[] = [];
  private vectors: VectorEntry[] = [];
  private nextSessionId = 1;
  private nextMessageId = 1;
  private nextVectorRowid = 1;
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(filePath?: string, vecDim = 1536) {
    this.vecDim = vecDim;
    this.filePath = filePath ?? null;
    if (this.filePath) this.load();
  }

  private load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      this.vecDim = snap.vecDim ?? this.vecDim;
      this.sessions = snap.sessions ?? [];
      this.messages = snap.messages ?? [];
      this.vectors = snap.vectors ?? [];
      this.nextSessionId = snap.nextSessionId ?? (this.sessions.reduce((m, s) => Math.max(m, s.id), 0) + 1);
      this.nextMessageId = snap.nextMessageId ?? (this.messages.reduce((m, x) => Math.max(m, x.id), 0) + 1);
      this.nextVectorRowid = snap.nextVectorRowid ?? (this.vectors.reduce((m, x) => Math.max(m, x.rowid), 0) + 1);
    } catch {
      // Corrupt snapshot — start fresh rather than crashing the agent on boot.
    }
  }

  private schedulePersist() {
    if (!this.filePath || this.closed) return;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.persistNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  private persistNow() {
    if (!this.filePath) return;
    const snap: Snapshot = {
      v: 1,
      vecDim: this.vecDim,
      nextSessionId: this.nextSessionId,
      nextMessageId: this.nextMessageId,
      nextVectorRowid: this.nextVectorRowid,
      sessions: this.sessions,
      messages: this.messages,
      vectors: this.vectors,
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Atomic write: tmp file + rename.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap));
    fs.renameSync(tmp, this.filePath);
  }

  getOrCreateSession(channel: string, chatId: string, topic = ''): number {
    const found = this.sessions.find(s => s.channel === channel && s.chat_id === chatId && s.topic === topic);
    if (found) return found.id;
    const id = this.nextSessionId++;
    this.sessions.push({ id, channel, chat_id: chatId, topic, created_at: Date.now() });
    this.schedulePersist();
    return id;
  }

  appendMessage(sessionId: number, role: Message['role'], content: string): number {
    const id = this.nextMessageId++;
    this.messages.push({ id, session_id: sessionId, role, content, created_at: Date.now() });
    this.schedulePersist();
    return id;
  }

  recentMessages(sessionId: number, limit = 50): Message[] {
    return this.messages.filter(m => m.session_id === sessionId).slice(0, limit);
  }

  indexVector(sessionId: number, ref: string, snippet: string, vec: Float32Array) {
    this.vectors.push({
      rowid: this.nextVectorRowid++,
      session_id: sessionId,
      ref,
      snippet,
      vec: Array.from(vec),
    });
    this.schedulePersist();
  }

  searchVectors(vec: Float32Array, k = 5): { snippet: string; ref: string; distance: number }[] {
    const scored = this.vectors.map(v => ({
      snippet: v.snippet,
      ref: v.ref,
      distance: cosineDistance(vec, v.vec),
    }));
    scored.sort((a, b) => a.distance - b.distance);
    return scored.slice(0, k);
  }

  countMessages(sessionId: number): number {
    let c = 0;
    for (const m of this.messages) if (m.session_id === sessionId) c++;
    return c;
  }

  /** Look up a session id without creating one. Returns null if it does not exist. */
  findSession(channel: string, chatId: string, topic = ''): number | null {
    const found = this.sessions.find(s => s.channel === channel && s.chat_id === chatId && s.topic === topic);
    return found ? found.id : null;
  }

  /** Delete all messages + vectors for a session (keeps the session row). Returns messages removed. */
  clearSession(sessionId: number): number {
    const msgsBefore = this.messages.length;
    this.messages = this.messages.filter(m => m.session_id !== sessionId);
    const removed = msgsBefore - this.messages.length;
    const vecsBefore = this.vectors.length;
    this.vectors = this.vectors.filter(v => v.session_id !== sessionId);
    if (removed > 0 || this.vectors.length !== vecsBefore) this.schedulePersist();
    return removed;
  }

  /** Aggregate counts across all sessions — used by the /status endpoint. */
  stats(): { sessions: number; messages: number; vectors: number } {
    return { sessions: this.sessions.length, messages: this.messages.length, vectors: this.vectors.length };
  }

  deleteOldMessages(sessionId: number, keepLast: number) {
    const idsDesc = this.messages
      .filter(m => m.session_id === sessionId)
      .map(m => m.id)
      .sort((a, b) => b - a);
    const keep = new Set(idsDesc.slice(0, keepLast));
    this.messages = this.messages.filter(m => m.session_id !== sessionId || keep.has(m.id));
    this.schedulePersist();
  }

  close() {
    this.closed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.persistNow();
  }
}

function cosineDistance(a: Float32Array | number[], b: Float32Array | number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}
