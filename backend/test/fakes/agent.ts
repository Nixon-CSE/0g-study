import { Hono } from 'hono';
import { stream } from 'hono/streaming';

export interface AgentFakeOptions {
  /** Map of incoming user text → reply text. Default: echoes the input. */
  replies?: Record<string, string>;
  /** Override per-call reply via function. Takes precedence over `replies`. */
  reply?: (input: { userId: string; text: string }) => string;
  /** Simulate stream delays in ms per chunk. Default: 0. */
  chunkDelayMs?: number;
}

export function makeAgentFake(opts: AgentFakeOptions = {}) {
  const app = new Hono();
  const pending = new Map<string, string>();

  app.post('/chat/message', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = body.text ?? '';
    const userId = body.userId ?? 'anonymous';
    const replyText = opts.reply?.({ userId, text }) ?? opts.replies?.[text] ?? `echo: ${text}`;
    const streamId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(streamId, replyText);
    return c.json({ streamId });
  });

  app.get('/chat/stream/:id', (c) => {
    const id = c.req.param('id');
    const replyText = pending.get(id) ?? '';
    pending.delete(id);
    return stream(c, async (s) => {
      const chunks = replyText.match(/.{1,16}/g) ?? [''];
      for (const ch of chunks) {
        s.write(`data: ${JSON.stringify({ chunk: ch })}\n\n`);
        if (opts.chunkDelayMs) await new Promise(r => setTimeout(r, opts.chunkDelayMs));
      }
      s.write(`event: done\ndata: {}\n\n`);
    });
  });

  return app;
}
