import { describe, it, expect } from 'vitest';
import { sessionsRoutes } from '../src/api/routes/sessions.js';

describe('sessionsRoutes', () => {
  it('POST /sessions/reset clears the requested session and reports the count', async () => {
    const calls: any[] = [];
    const app = sessionsRoutes({ resetSession: (k) => { calls.push(k); return 3; } });
    const res = await app.request('/sessions/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'web', chatId: 'u1' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, cleared: 3 });
    expect(calls).toEqual([{ channel: 'web', chatId: 'u1', topic: undefined }]);
  });

  it('defaults channel to "web" when omitted', async () => {
    const calls: any[] = [];
    const app = sessionsRoutes({ resetSession: (k) => { calls.push(k); return 0; } });
    const res = await app.request('/sessions/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId: 'u1' }),
    });
    expect(res.status).toBe(200);
    expect(calls[0].channel).toBe('web');
  });

  it('returns 400 when chatId is missing', async () => {
    const app = sessionsRoutes({ resetSession: () => { throw new Error('should not be called'); } });
    const res = await app.request('/sessions/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel: 'web' }),
    });
    expect(res.status).toBe(400);
  });
});
