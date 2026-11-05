import { tool } from 'ai';
import { z } from 'zod';

/**
 * Gives the agent the current date/time — models have no reliable clock of their
 * own. Returns a machine-readable ISO string plus a human-readable rendering in
 * the requested IANA timezone (defaults to UTC).
 */
export const currentTimeTool = tool({
  description:
    'Get the current date and time. Optionally pass an IANA timezone (e.g. "America/New_York"); defaults to UTC.',
  parameters: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone name, e.g. "Europe/London". Defaults to UTC.'),
  }),
  execute: async ({ timezone }) => {
    const tz = timezone ?? 'UTC';
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        dateStyle: 'full',
        timeStyle: 'long',
      });
    } catch {
      throw new Error(`Invalid timezone: ${tz}`);
    }
    const now = new Date();
    return {
      iso: now.toISOString(),
      unixMs: now.getTime(),
      timezone: tz,
      formatted: formatter.format(now),
    };
  },
});
