import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mcpRoutes } from '../src/api/routes/mcp.js';

describe('mcpRoutes', () => {
  let dir: string;
  let restarted: number;
  let app: ReturnType<typeof mcpRoutes>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bf-mcp-'));
    restarted = 0;
    app = mcpRoutes({ agentDir: dir, restartMcp: async () => { restarted++; } });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const readMcp = async () => JSON.parse(await fs.readFile(path.join(dir, 'mcp.json'), 'utf8'));

  it('POST succeeds when mcp.json has no "servers" key', async () => {
    await fs.writeFile(path.join(dir, 'mcp.json'), '{}');
    const res = await app.request('/mcp/servers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'foo', command: 'bar' }),
    });
    expect(res.status).toBe(200);
    const written = await readMcp();
    expect(written.servers.foo.command).toBe('bar');
    expect(restarted).toBe(1);
  });

  it('DELETE succeeds when mcp.json has no "servers" key', async () => {
    await fs.writeFile(path.join(dir, 'mcp.json'), '{}');
    const res = await app.request('/mcp/servers/foo', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(restarted).toBe(1);
  });

  it('DELETE normalizes remaining entries against the schema', async () => {
    await fs.writeFile(
      path.join(dir, 'mcp.json'),
      JSON.stringify({ servers: { keep: { command: 'x' }, drop: { command: 'y' } } }),
    );
    const res = await app.request('/mcp/servers/drop', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const written = await readMcp();
    expect(written.servers.drop).toBeUndefined();
    // schema defaults must be applied to the surviving entry
    expect(written.servers.keep).toEqual({ command: 'x', args: [], env: {}, enabled: true });
  });
});
