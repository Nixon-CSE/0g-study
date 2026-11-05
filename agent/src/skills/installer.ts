import fs from 'node:fs/promises';
import path from 'node:path';
import { scanContent } from './scanner.js';
import { AgentSkillShClient } from './registry-clients/agentskill-sh.js';
import { ClawHubClient } from './registry-clients/clawhub.js';
import { GitUrlClient } from './registry-clients/skills-sh.js';
import type { InstallRequest } from './registry-clients/base.js';
import { log } from '../util/logger.js';
import { assertInside } from '../util/paths.js';

export type EvolutionMode = 'off' | 'suggest' | 'auto-safe' | 'auto-all';

const clients = {
  'agentskill.sh': new AgentSkillShClient(),
  'clawhub': new ClawHubClient(),
  'url': new GitUrlClient(),
};

export interface InstallResult {
  ok: boolean;
  slug?: string;
  dir?: string;
  securityScore?: number;
  reason?: string;
  findings?: { critical: any[]; warnings: any[] };
}

export async function installSkill(
  agentDir: string,
  source: keyof typeof clients,
  req: InstallRequest,
  mode: EvolutionMode = 'suggest'
): Promise<InstallResult> {
  const targetDir = path.join(agentDir, 'skills');
  await fs.mkdir(targetDir, { recursive: true });
  const client = clients[source];
  if (!client) return { ok: false, reason: `unknown source: ${source}` };

  // Registry clients (npx subprocess for agentskill.sh, git clone for url, etc.)
  // throw on non-zero exit. Wrap so the HTTP route surfaces a structured 400
  // instead of crashing into a 500.
  let installed;
  try {
    installed = await client.install(req, targetDir);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    log.warn({ source, slug: req.slug, msg }, 'skill install: registry client failed');
    return { ok: false, reason: `registry_install_failed: ${msg}` };
  }
  // Registry clients (especially agentskill.sh's CLI) don't always land the
  // SKILL.md at the path we predicted from the slug — it may be nested one
  // level deeper, or live next to the targetDir if the CLI chose its own
  // folder name. Locate it dynamically + accept lowercase variants.
  let skillMdPath: string | null = null;
  let content = '';
  try {
    skillMdPath = await findSkillMd(installed.dir);
    // Some CLIs unpack into targetDir/<other-name>/ — search the parent too.
    if (!skillMdPath) {
      const parent = path.dirname(installed.dir);
      skillMdPath = await findSkillMd(parent, /*maxDepth*/ 2, /*exclude*/ installed.dir);
    }
    if (skillMdPath) {
      content = await fs.readFile(skillMdPath, 'utf8');
      // Re-point installed.dir to wherever the SKILL.md actually lives so
      // downstream code (scanner, scanContent, dir return value) works.
      installed.dir = path.dirname(skillMdPath);
    }
  } catch { /* fall through to the not-found branch */ }
  if (!skillMdPath || !content) {
    // Surface the directory listing so callers can see WHAT got installed.
    let listing: string[] = [];
    try { listing = (await listTreeShallow(installed.dir, 3)).slice(0, 40); } catch { /* ignore */ }
    await fs.rm(installed.dir, { recursive: true, force: true }).catch(() => {});
    log.warn({ source, slug: req.slug, dir: installed.dir, listing }, 'skill install: no SKILL.md');
    return { ok: false, reason: `no SKILL.md found (installed dir contained: ${listing.join(', ') || '(empty)'})` };
  }

  const findings = scanContent(content);
  if (findings.critical.length > 0) {
    await fs.rm(installed.dir, { recursive: true, force: true });
    log.warn({ findings: findings.critical }, 'skill blocked by scanner');
    return { ok: false, reason: 'scanner: critical findings', findings };
  }
  if (mode === 'auto-safe') {
    const requiresBins = /requires:\s*\n[\s\S]*?bins:\s*\[[^\]\n]+\]/.test(content);
    if (requiresBins) {
      await fs.rm(installed.dir, { recursive: true, force: true });
      return { ok: false, reason: 'auto-safe: skill requires bins', findings };
    }
  }
  return { ok: true, slug: installed.slug, dir: installed.dir, findings };
}

/**
 * Walk `root` up to `maxDepth` levels deep looking for a file named SKILL.md
 * (case-insensitive). Returns the first match, or null. `exclude` lets us
 * skip a subtree we've already searched.
 */
async function findSkillMd(root: string, maxDepth = 3, exclude?: string): Promise<string | null> {
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > maxDepth) return null;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (exclude && full === exclude) continue;
      if (e.isFile() && e.name.toLowerCase() === 'skill.md') return full;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (exclude && full === exclude) continue;
      const hit = await walk(full, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  return walk(root, 0);
}

/** Shallow tree listing used in error messages so we can see what got installed. */
async function listTreeShallow(root: string, maxDepth = 2): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number, prefix: string) {
    if (depth > maxDepth) return;
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      out.push(prefix + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory() && depth < maxDepth) {
        await walk(path.join(dir, e.name), depth + 1, prefix + e.name + '/');
      }
    }
  }
  await walk(root, 0, '');
  return out;
}

export async function removeSkill(agentDir: string, slug: string): Promise<boolean> {
  // Reject anything that isn't a single safe path segment.
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) return false;
  const skillsRoot = path.resolve(agentDir, 'skills');
  let dir: string;
  try { dir = assertInside(skillsRoot, slug); }
  catch { return false; }
  try { await fs.rm(dir, { recursive: true, force: true }); return true; } catch { return false; }
}
