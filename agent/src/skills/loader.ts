import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import chokidar from 'chokidar';
import { log } from '../util/logger.js';

export interface SkillRecord {
  name: string;
  description: string;
  dir: string;
  body: string;
  userInvocable: boolean;
  disableModelInvocation: boolean;
  requires: { bins: string[]; env: string[]; anyBins: string[] };
  always: boolean;
  source?: { slug: string; owner: string; contentSha?: string; installed?: string; sourceUrl?: string };
}

const AGS_HEADER_RE = /^---\s*agentskill\.sh\s*---\s*\n([\s\S]*?)\n---\s*\n/;

function stripAgsHeader(raw: string): { source?: SkillRecord['source']; rest: string } {
  const m = raw.match(AGS_HEADER_RE);
  if (!m) return { rest: raw };
  const lines = m[1].split('\n');
  const meta: any = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return {
    source: {
      slug: meta.slug, owner: meta.owner, contentSha: meta.contentSha,
      installed: meta.installed, sourceUrl: meta.source,
    },
    rest: raw.slice(m[0].length),
  };
}

export async function loadSkills(agentDir: string): Promise<SkillRecord[]> {
  const skillsDir = path.join(agentDir, 'skills');
  let entries: string[];
  try { entries = await fs.readdir(skillsDir); } catch { return []; }
  const out: SkillRecord[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = path.join(skillsDir, name);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    const file = path.join(dir, 'SKILL.md');
    try {
      const raw = await fs.readFile(file, 'utf8');
      const { source, rest } = stripAgsHeader(raw);
      const parsed = matter(rest);
      const fm: any = parsed.data ?? {};
      out.push({
        name: fm.name ?? name,
        description: fm.description ?? '',
        dir,
        body: parsed.content,
        userInvocable: fm['user-invocable'] !== false,
        disableModelInvocation: !!fm['disable-model-invocation'],
        requires: {
          bins: fm?.metadata?.openclaw?.requires?.bins ?? [],
          env: fm?.metadata?.openclaw?.requires?.env ?? [],
          anyBins: fm?.metadata?.openclaw?.requires?.anyBins ?? [],
        },
        always: !!fm?.metadata?.openclaw?.always,
        source,
      });
    } catch (e) { log.warn({ err: e, file }, 'failed to load skill'); }
  }
  return out;
}

export function watchSkills(agentDir: string, onChange: () => void): () => void {
  const w = chokidar.watch(path.join(agentDir, 'skills'), { ignoreInitial: true, depth: 3 });
  const fire = () => onChange();
  w.on('add', fire).on('change', fire).on('unlink', fire).on('addDir', fire).on('unlinkDir', fire);
  return () => { w.close(); };
}

export function checkGating(s: SkillRecord): { eligible: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const e of s.requires.env) if (!process.env[e]) missing.push(`env:${e}`);
  return { eligible: missing.length === 0, missing };
}
