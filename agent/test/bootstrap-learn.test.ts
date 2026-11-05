import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findLearnSkillDir } from '../src/skills/bootstrap.js';

const dirs: string[] = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ags-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('findLearnSkillDir', () => {
  it('finds the current layout (skills/learn/SKILL.md)', async () => {
    const repo = mk();
    fs.mkdirSync(path.join(repo, 'skills', 'learn'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'skills', 'learn', 'SKILL.md'), '---\nname: learn\n---');
    expect(await findLearnSkillDir(repo)).toBe(path.join(repo, 'skills', 'learn'));
  });
  it('falls back to the old root layout', async () => {
    const repo = mk();
    fs.writeFileSync(path.join(repo, 'SKILL.md'), '---\nname: learn\n---');
    expect(await findLearnSkillDir(repo)).toBe(path.join(repo, '.'));
  });
  it('returns null when there is no SKILL.md', async () => {
    expect(await findLearnSkillDir(mk())).toBeNull();
  });
});
