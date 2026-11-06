import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import abi from '../src/chain/bonfire-agent-inft-abi.js';
import { AGENT_ADMIN_HEADER, agentAdminHeaders } from '../src/agents/admin-token.js';

const BACKEND = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('the backend image only contains backend/', () => {
  it('no source file imports from outside backend/', () => {
    const outside: string[] = [];
    for (const f of sourceFiles(path.join(BACKEND, 'src'))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:from|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)) {
        if (path.relative(BACKEND, path.resolve(path.dirname(f), m[1])).startsWith('..')) outside.push(`${path.relative(BACKEND, f)}: ${m[1]}`);
      }
    }
    expect(outside).toEqual([]);
  });
  it("the ABI copy matches the contract's", () => {
    const real = JSON.parse(fs.readFileSync(path.resolve(BACKEND, '../contracts/abi/BonFireAgentINFT.json'), 'utf8'));
    expect(abi).toEqual(real);
  });
});

describe('admin token with a public agent URL (free plan: no private network)', () => {
  const saved = { token: process.env.AGENT_ADMIN_TOKEN, base: process.env.EMBER_AGENT_BASE_URL };
  afterEach(() => {
    if (saved.token === undefined) delete process.env.AGENT_ADMIN_TOKEN; else process.env.AGENT_ADMIN_TOKEN = saved.token;
    if (saved.base === undefined) delete process.env.EMBER_AGENT_BASE_URL; else process.env.EMBER_AGENT_BASE_URL = saved.base;
  });
  it('goes only to that exact origin', () => {
    process.env.AGENT_ADMIN_TOKEN = 't'.repeat(64);
    process.env.EMBER_AGENT_BASE_URL = 'https://0g-study-agent.onrender.com';
    expect(agentAdminHeaders('https://0g-study-agent.onrender.com/tenants')).toEqual({ [AGENT_ADMIN_HEADER]: 't'.repeat(64) });
    for (const url of [
      'https://someone-else.onrender.com/chat/message',
      'https://0g-study-agent.onrender.com.evil.example/x',
      'http://0g-study-agent.onrender.com/tenants',
      'https://evil.example/https://0g-study-agent.onrender.com',
    ]) expect(agentAdminHeaders(url), url).toEqual({});
  });
});

