import { createHash } from 'node:crypto';

export function hashEnv(env: Record<string, string> | undefined): string {
  if (!env || Object.keys(env).length === 0) return '0';
  const sorted = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}
