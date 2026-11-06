import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import abi from '../src/chain/bonfire-agent-inft-abi.js';

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
