import { describe, it, expect } from 'vitest';
import { loadSkills } from '../src/skills/loader.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('loadSkills', () => {
  it('parses SKILL.md with agentskill.sh header', async () => {
    const skills = await loadSkills(path.resolve(__dirname, 'fixtures/test-agent'));
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe('sample');
    expect(skills[0].source?.slug).toBe('sample');
    expect(skills[0].source?.owner).toBe('tester');
  });
});
