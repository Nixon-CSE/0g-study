import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/runtime/prompt-builder.js';

describe('buildSystemPrompt', () => {
  it('composes SOUL, AGENTS, skills XML, memory', () => {
    const s = buildSystemPrompt({
      agentName: 'Ember',
      soul: 'Be terse.',
      agents: 'Ask before destructive ops.',
      skills: [{ name: 'sample', description: 'sample skill', dir: '/skills/sample' } as any],
      memorySnippets: ['previous: hello'],
    });
    expect(s).toContain('You are Ember');
    expect(s).toContain('<soul>');
    expect(s).toContain('Be terse.');
    expect(s).toContain('<operating_rules>');
    expect(s).toContain('Ask before destructive ops.');
    expect(s).toContain('<available_skills>');
    expect(s).toContain('sample');
    expect(s).toContain('<memory_context>');
    expect(s).toContain('previous: hello');
  });
});
