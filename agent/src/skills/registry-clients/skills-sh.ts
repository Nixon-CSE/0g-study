import { spawn } from 'node:child_process';
import path from 'node:path';
import type { RegistryClient, InstallRequest, InstalledSkill } from './base.js';

export class GitUrlClient implements RegistryClient {
  id = 'url';
  async install(req: InstallRequest, targetDir: string): Promise<InstalledSkill> {
    const url = req.url; if (!url) throw new Error('url required');
    const slug = (url.split('/').pop() ?? 'skill').replace(/\.git$/, '');
    const dir = path.join(targetDir, slug);
    await new Promise<void>((resolve, reject) => {
      const p = spawn('git', ['clone', '--depth', '1', url, dir], { stdio: 'inherit' });
      p.on('exit', (c) => c === 0 ? resolve() : reject(new Error(`git clone exit ${c}`)));
      p.on('error', reject);
    });
    return { slug, dir };
  }
}
