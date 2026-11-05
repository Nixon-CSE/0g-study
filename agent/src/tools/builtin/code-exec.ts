import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'node:child_process';

// NOTE: This tool is NOT a sandbox — it relies on a timeout only. Disabled by default.
export function makeCodeExecTool(timeoutMs: number) {
  return tool({
    description: 'Execute a short command in a subprocess (NOT a sandbox — relies on timeout only). Disabled by default.',
    parameters: z.object({ cmd: z.string(), args: z.array(z.string()).default([]) }),
    execute: async ({ cmd, args }) => {
      return await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
        const p = spawn(cmd, args, { shell: false, timeout: timeoutMs });
        let stdout = '', stderr = '';
        p.stdout?.on('data', (b) => stdout += b.toString());
        p.stderr?.on('data', (b) => stderr += b.toString());
        p.on('close', (code) => resolve({ stdout: stdout.slice(0, 20_000), stderr: stderr.slice(0, 20_000), code: code ?? -1 }));
        p.on('error', (e) => resolve({ stdout: '', stderr: String(e), code: -1 }));
      });
    },
  });
}
