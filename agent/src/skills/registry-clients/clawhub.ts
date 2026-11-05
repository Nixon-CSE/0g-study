import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RegistryClient, InstallRequest, InstalledSkill } from './base.js';

export class ClawHubClient implements RegistryClient {
  id = 'clawhub';
  async install(req: InstallRequest, targetDir: string): Promise<InstalledSkill> {
    const slug = req.slug; if (!slug) throw new Error('slug required');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('openclaw', ['skills', 'install', slug, '--target', targetDir], { stdio: 'inherit' });
      p.on('exit', (c) => c === 0 ? resolve() : reject(new Error(`openclaw exit ${c}`)));
      p.on('error', reject);
    });
    return { slug, dir: path.join(targetDir, slug) };
  }
}
