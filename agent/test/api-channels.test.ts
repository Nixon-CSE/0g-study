import { describe, it, expect } from 'vitest';
import { channelRoutes } from '../src/api/routes/channels.js';

describe('channelRoutes', () => {
  it('rejects an invalid telegram body with 400 and does not patch', async () => {
    const calls: any[] = [];
    const app = channelRoutes({ patchTelegram: async (p) => { calls.push(p); } });
    const res = await app.request('/channels/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dmPolicy: 'bogus' }),
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('accepts a valid partial body and forwards the parsed config', async () => {
    const calls: any[] = [];
    const app = channelRoutes({ patchTelegram: async (p) => { calls.push(p); } });
    const res = await app.request('/channels/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].enabled).toBe(true);
  });
});
