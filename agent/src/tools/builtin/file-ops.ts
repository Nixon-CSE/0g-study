import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertInside } from '../../util/paths.js';

export function makeFileOpsTools(rootDir: string) {
  const root = path.resolve(rootDir);
  const safe = (p: string) => assertInside(root, p);
  return {
    fs_read: tool({
      description: 'Read a UTF-8 file from the sandbox.',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path: p }) => ({ content: await fs.readFile(safe(p), 'utf8') }),
    }),
    fs_write: tool({
      description: 'Write a UTF-8 file in the sandbox.',
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: p, content }) => {
        const abs = safe(p);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
        return { ok: true };
      },
    }),
    fs_list: tool({
      description: 'List sandbox files.',
      parameters: z.object({ dir: z.string().default('.') }),
      execute: async ({ dir }) => ({ entries: await fs.readdir(safe(dir)) }),
    }),
  };
}
