import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { log } from '../util/logger.js';

const REPO = 'https://github.com/agentskill-sh/ags.git';
const RAW_BASE = 'https://raw.githubusercontent.com/agentskill-sh/ags/HEAD';
/**
 * Where the /learn skill lives inside the ags repo. The repo moved it from the root to
 * skills/learn/; try the current layout first and keep the old one as a fallback.
 */
export const LEARN_SKILL_CANDIDATES = ['skills/learn', '.'];

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Find the folder holding the /learn SKILL.md inside a cloned ags repo, or null. */
export async function findLearnSkillDir(repoDir: string): Promise<string | null> {
  for (const rel of LEARN_SKILL_CANDIDATES) {
    const dir = path.join(repoDir, rel);
    if (await exists(path.join(dir, 'SKILL.md'))) return dir;
  }
  return null;
}

async function fetchViaHttps(dir: string): Promise<boolean> {
  for (const rel of LEARN_SKILL_CANDIDATES) {
    const url = `${RAW_BASE}/${rel === '.' ? '' : `${rel}/`}SKILL.md`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!r.ok) continue;
      const body = await r.text();
      if (!body.trim()) continue;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'SKILL.md'), body);
      log.info({ url }, 'Installed /learn SKILL.md via HTTPS.');
      return true;
    } catch { /* try next candidate */ }
  }
  log.error('/learn bootstrap failed; continuing without it');
  return false;
}

function gitClone(dest: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('git', ['clone', '--depth', '1', REPO, dest], { stdio: 'ignore' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`git clone exit ${c}`))));
    p.on('error', reject);
  });
}

export async function ensureLearnSkill(agentDir: string): Promise<void> {
  const skillsDir = path.join(agentDir, 'skills');
  const dir = path.join(skillsDir, 'learn');
  if (await exists(path.join(dir, 'SKILL.md'))) return;
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.rm(dir, { recursive: true, force: true }); // drop any half-installed folder

  // Clone into a temp folder inside skills/ (dot-prefixed so the loader ignores it), then copy only the skill.
  const tmp = path.join(skillsDir, `.learn-clone-${process.pid}`);
  try {
    await gitClone(tmp);
    const src = await findLearnSkillDir(tmp);
    if (!src) throw new Error('no SKILL.md for /learn in the cloned repo');
    await fs.cp(src, dir, { recursive: true, filter: (p) => !p.split(path.sep).includes('.git') });
    log.info('Installed /learn skill from agentskill.sh — agent can now search and install skills autonomously.');
  } catch (e) {
    log.warn({ err: String((e as Error)?.message ?? e) }, 'git install of /learn failed; falling back to HTTPS SKILL.md fetch');
    await fs.rm(dir, { recursive: true, force: true });
    await fetchViaHttps(dir);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
