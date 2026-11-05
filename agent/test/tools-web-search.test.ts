import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeWebSearchTool } from '../src/tools/builtin/web-search.js';

const run = (provider: 'tavily' | 'brave') =>
  (makeWebSearchTool(provider, 'key') as any).execute({ query: 'q', topK: 3 }, {} as any);

describe('makeWebSearchTool', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws when the tavily API returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'rate limited' }),
      text: async () => 'rate limited',
    })));
    await expect(run('tavily')).rejects.toThrow(/429/);
  });

  it('throws when the brave API returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
      text: async () => 'unauthorized',
    })));
    await expect(run('brave')).rejects.toThrow(/401/);
  });

  it('returns parsed json when the API responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [1, 2] }),
      text: async () => '',
    })));
    await expect(run('tavily')).resolves.toEqual({ results: [1, 2] });
  });
});
