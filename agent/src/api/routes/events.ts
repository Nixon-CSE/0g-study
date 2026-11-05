import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { EventEmitter } from 'node:events';

export function eventsRoutes(bus: EventEmitter) {
  const app = new Hono();
  app.get('/events', (c) => stream(c, async (s) => {
    const handler = (ev: any) => s.write(`data: ${JSON.stringify(ev)}\n\n`);
    bus.on('event', handler);
    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => { bus.off('event', handler); resolve(); });
    });
  }));
  return app;
}
