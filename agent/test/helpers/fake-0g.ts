/**
 * A stand-in for 0G Private Computer in tests: /embeddings returns deterministic bag-of-words vectors
 * (texts that share words are similar), /chat/completions returns canned vision transcriptions.
 * Every response carries an x-request-id like the real router (gateway id, UUID).
 */
import crypto from 'node:crypto';

export const DIM = 64;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'is', 'are', 'what', 'how', 'do', 'does', 'it', 'on', 'for', 'with', 'by', 'from', 'that', 'this']);

export function fakeVector(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(w) || w.length < 3) continue;
    const h = crypto.createHash('sha256').update(w).digest();
    v[h[0] % DIM] += 1;
    v[h[1] % DIM] += 0.5;
  }
  if (v.every((x) => x === 0)) v[0] = 1e-3;
  return v;
}

export interface FakeCall { url: string; body: any; auth: string | null }

export function fake0G(opts: { notesFor?: (dataUrl: string) => string; embeddingsDown?: () => boolean } = {}) {
  const calls: FakeCall[] = [];
  let n = 0;
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ url, body, auth: new Headers(init.headers).get('authorization') });
    const id = `${(++n).toString(16).padStart(16, '0')}, ${crypto.randomUUID()}`;
    const headers = { 'content-type': 'application/json', 'x-request-id': id };
    if (url.endsWith('/embeddings')) {
      if (opts.embeddingsDown?.()) return new Response('{"error":"upstream unavailable"}', { status: 503, headers });
      const input: string[] = Array.isArray(body.input) ? body.input : [body.input];
      return new Response(JSON.stringify({
        data: input.map((t, index) => ({ index, embedding: fakeVector(t) })),
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }), { status: 200, headers });
    }
    if (url.endsWith('/chat/completions')) {
      const img = body.messages?.[0]?.content?.[1]?.image_url?.url ?? '';
      const notes = opts.notesFor?.(img) ?? '# Notes\nnothing';
      return new Response(JSON.stringify({ choices: [{ message: { content: notes } }], usage: { total_tokens: 100 } }), { status: 200, headers });
    }
    return new Response('{}', { status: 404, headers });
  };
  return { calls, fetchImpl };
}
