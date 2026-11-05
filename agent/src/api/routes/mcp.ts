import { Hono } from 'hono';
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpJsonSchema, type McpJson } from '../../config/schema.js';

export function mcpRoutes(opts: { agentDir: string; restartMcp: () => Promise<void> }) {
  const app = new Hono();
  const file = path.join(opts.agentDir, 'mcp.json');

  // Read + normalize mcp.json. A missing, unparseable, or schema-invalid file
  // (e.g. one without a "servers" key) falls back to an empty, valid config so
  // handlers never mutate a half-formed object.
  const read = async (): Promise<McpJson> => {
    try { return McpJsonSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))); }
    catch { return { servers: {} }; }
  };
  // Validate before persisting so the file on disk always conforms to the schema.
  const write = async (raw: McpJson) => {
    await fs.writeFile(file, JSON.stringify(McpJsonSchema.parse(raw), null, 2));
    await opts.restartMcp();
  };

  app.get('/mcp/servers', async (c) => {
    const raw = await read();
    return c.json({ servers: raw.servers });
  });
  app.post('/mcp/servers', async (c) => {
    const { id, command, args = [], env = {}, enabled = true } = await c.req.json();
    if (!id || !command) return c.json({ ok: false, error: 'id and command required' }, 400);
    const raw = await read();
    raw.servers[id] = { command, args, env, enabled };
    await write(raw);
    return c.json({ ok: true });
  });
  app.delete('/mcp/servers/:id', async (c) => {
    const id = c.req.param('id');
    const raw = await read();
    delete raw.servers[id];
    await write(raw);
    return c.json({ ok: true });
  });
  return app;
}
