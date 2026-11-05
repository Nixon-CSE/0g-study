import { tool } from 'ai';
import { z } from 'zod';

export const webFetchTool = tool({
  description: 'Fetch a URL and return text (first 100KB).',
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
        const text = await res.text();
        return { ok: res.ok, status: res.status, text: text.slice(0, 100_000) };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      return { ok: false, error: e?.name === 'AbortError' ? 'timeout after 15s' : String(e?.message ?? e) };
    }
  },
});
