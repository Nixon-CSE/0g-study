import { describe, it, expect } from 'vitest';
import { currentTimeTool } from '../src/tools/builtin/current-time.js';

const run = (args: any) => (currentTimeTool as any).execute(args, {} as any);

describe('currentTimeTool', () => {
  it('returns a valid ISO timestamp and unix millis (defaults to UTC)', async () => {
    const r = await run({});
    expect(new Date(r.iso).toString()).not.toBe('Invalid Date');
    expect(typeof r.unixMs).toBe('number');
    expect(r.timezone).toBe('UTC');
    expect(typeof r.formatted).toBe('string');
  });

  it('honors an IANA timezone', async () => {
    const utc = await run({ timezone: 'UTC' });
    const ny = await run({ timezone: 'America/New_York' });
    expect(ny.timezone).toBe('America/New_York');
    // New York is never at a zero offset, so its wall-clock string differs from UTC.
    expect(ny.formatted).not.toBe(utc.formatted);
  });

  it('throws on an invalid timezone', async () => {
    await expect(run({ timezone: 'Not/AZone' })).rejects.toThrow(/timezone/i);
  });
});
