import { describe, it, expect } from 'vitest';
import { pinModel } from '../src/voice/og-llm-proxy.js';

describe('pinModel (voice LLM proxy)', () => {
  it("replaces the caller's model with the provider's model", () => {
    const out = JSON.parse(pinModel(JSON.stringify({ model: 'gpt-4o-mini', stream: true, messages: [] }), 'qwen-2.5-7b'));
    expect(out).toEqual({ model: 'qwen-2.5-7b', stream: true, messages: [] });
  });
  it('passes non-JSON bodies through', () => {
    expect(pinModel('not json', 'm')).toBe('not json');
  });
});
