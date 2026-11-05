import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RegistryClient, InstallRequest, InstalledSkill } from './base.js';

export class AgentSkillShClient implements RegistryClient {
  id = 'agentskill.sh';
  async install(req: InstallRequest, targetDir: string): Promise<InstalledSkill> {
    const slug = req.slug ?? req.query;
    if (!slug) throw new Error('slug or query required');
    // The @agentskill.sh/cli ignores --target and writes to <cwd>/skills/<name>/
    // (its "OpenClaw" target). To make our targetDir match that path, we need
    // cwd to be the parent of targetDir — i.e. the agent dir.
    const cwd = path.dirname(targetDir);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        'npx',
        ['-y', '@agentskill.sh/cli@latest', 'install', slug, '--target', targetDir],
        { stdio: 'inherit', cwd },
      );
      p.on('exit', (c) => c === 0 ? resolve() : reject(new Error(`agentskill.sh install exit ${c}`)));
      p.on('error', reject);
    });
    const installedSlug = slug.includes('/') ? slug.split('/').pop()! : slug;
    return { slug: installedSlug, dir: path.join(targetDir, installedSlug) };
  }
}
