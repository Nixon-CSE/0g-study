import { tool } from 'ai';
import { z } from 'zod';

export function makeWebSearchTool(provider: 'tavily' | 'brave', apiKey: string) {
  return tool({
    description: 'Search the web and return top results.',
    parameters: z.object({ query: z.string(), topK: z.number().default(5) }),
    execute: async ({ query, topK }) => {
      if (provider === 'tavily') {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query, max_results: topK }),
        });
        if (!r.ok) throw new Error(`Tavily search failed: ${r.status} ${await r.text().catch(() => '')}`);
        return await r.json();
      }
      const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${topK}`, {
        headers: { 'X-Subscription-Token': apiKey, accept: 'application/json' },
      });
      if (!r.ok) throw new Error(`Brave search failed: ${r.status} ${await r.text().catch(() => '')}`);
      return await r.json();
    },
  });
}
