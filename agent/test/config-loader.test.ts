import { describe, it, expect } from 'vitest';
import { AgentConfigSchema } from '../src/config/schema.js';
import { loadAgent } from '../src/config/loader.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('AgentConfigSchema', () => {
  it('parses a minimal config with defaults', () => {
    const parsed = AgentConfigSchema.parse({
      name: 'Test', id: 'test',
      llm: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    });
    expect(parsed.llm.temperature).toBe(0.7);
    expect(parsed.evolution.mode).toBe('suggest');
    expect(parsed.channels.web.enabled).toBe(true);
  });

  it('rejects bad evolution mode', () => {
    expect(() => AgentConfigSchema.parse({
      name: 'x', id: 'x',
      llm: { baseUrl: 'u', model: 'm' },
      evolution: { mode: 'bogus' }
    } as any)).toThrow();
  });
});

describe('loadAgent', () => {
  it('loads fixture agent', async () => {
    const a = await loadAgent(path.resolve(__dirname, 'fixtures/test-agent'));
    expect(a.config.name).toBe('Tester');
    expect(a.soul).toContain('terse');
    expect(a.agents).toContain('Default');
    expect(a.mcp.servers).toBeDefined();
  });
});
