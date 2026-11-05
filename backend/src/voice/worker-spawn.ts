/**
 * Spawns a Python bot subprocess (Task B: pipecat-bot.py).
 * - Pipes stdout → log.info, stderr → log.warn line-by-line
 * - kill() sends SIGTERM; escalates to SIGKILL after 5 s grace period
 */

import { spawn } from 'node:child_process';
import { log } from '../util/logger.js';

export interface SpawnedBot {
  pid: number;
  kill: () => void;
}

export function defaultBotSpawner(opts: {
  workerCmd: string;
  workerScript: string;
  cwd: string;
}): (env: Record<string, string>) => SpawnedBot {
  return (env: Record<string, string>): SpawnedBot => {
    const { workerCmd, workerScript, cwd } = opts;

    log.info({ workerCmd, workerScript }, 'spawning voice bot');

    const child = spawn(workerCmd, [workerScript], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    });

    const pid = child.pid ?? 0;

    // Pipe stdout / stderr into pino
    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) log.info({ pid, src: 'bot:stdout' }, trimmed);
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        const trimmed = line.trim();
        if (trimmed) log.warn({ pid, src: 'bot:stderr' }, trimmed);
      }
    });

    child.on('exit', (code, signal) => {
      log.info({ pid, code, signal }, 'voice bot exited');
    });

    child.on('error', (err) => {
      log.warn({ pid, err }, 'voice bot process error');
    });

    let killed = false;
    const kill = () => {
      if (killed) return;
      killed = true;
      if (child.exitCode !== null) return;          // already exited
      log.info({ pid }, 'sending SIGTERM to voice bot');
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null) {
          log.warn({ pid }, 'SIGTERM grace expired, escalating to SIGKILL');
          child.kill('SIGKILL');
        }
      }, 5_000);
      timer.unref();                                 // don't hold the event loop
    };

    return { pid, kill };
  };
}
