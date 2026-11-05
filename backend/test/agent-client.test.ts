import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve } from '@hono/node-server';
import { makeAgentFake } from './fakes/agent.js';
import { invokeAgent } from '../src/agents/client.js';

describe('agent client', () => {
  let server: ReturnType<typeof serve>;
  let port: number;

  beforeAll(async () => {
    const app = makeAgentFake({ reply: ({ text }) => `pong:${text}` });
    server = serve({ fetch: app.fetch, port: 0 });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    port = (server.address() as any).port;
  });
  afterAll(() => { server.close(); });

  it('accumulates the full reply over SSE', async () => {
    const reply = await invokeAgent({
      baseUrl: `http://127.0.0.1:${port}`,
      chatId: 'bonfire:channel:abc',
      text: 'hello',
    });
    expect(reply).toBe('pong:hello');
  });

  it('throws when /chat/message returns non-2xx', async () => {
    await expect(invokeAgent({
      baseUrl: `http://127.0.0.1:${port + 9000}`,
      chatId: 'x', text: 'y',
    })).rejects.toThrow();
  });
});
