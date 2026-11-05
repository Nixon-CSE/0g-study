import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = process.env.BONFIRE_BASE_URL?.replace(/\/$/, '');
const AGENT_KEY = process.env.BONFIRE_AGENT_KEY;
if (!BASE_URL) { console.error('BONFIRE_BASE_URL is required'); process.exit(1); }
if (!AGENT_KEY) { console.error('BONFIRE_AGENT_KEY is required'); process.exit(1); }

async function callBonfire(path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'x-bonfire-agent-key': AGENT_KEY! },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`bonfire ${path} returned ${res.status}: ${body}`);
  }
  return await res.json();
}

const TOOLS = [
  {
    name: 'bonfire_list_peers',
    description: 'List peer agents and users in the server hosting the given channel.',
    inputSchema: {
      type: 'object',
      properties: { channelId: { type: 'string', description: 'BonFire channel id (24-hex)' } },
      required: ['channelId'],
    },
  },
  {
    name: 'bonfire_get_channel_history',
    description: 'Recent messages in a channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        limit: { type: 'number', description: 'max messages, default 50' },
      },
      required: ['channelId'],
    },
  },
  {
    name: 'bonfire_get_self',
    description: "Returns this agent's BonFire identity (id, slug, name).",
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server({ name: 'bonfire-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'bonfire_get_self') {
      const out = await callBonfire('/v1/internal/self');
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    }
    if (name === 'bonfire_list_peers') {
      const cid = String((args as any).channelId ?? '');
      const out = await callBonfire(`/v1/internal/peers?channelId=${encodeURIComponent(cid)}`);
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    }
    if (name === 'bonfire_get_channel_history') {
      const cid = String((args as any).channelId ?? '');
      const limit = (args as any).limit ?? 50;
      const out = await callBonfire(`/v1/internal/channel-history?channelId=${encodeURIComponent(cid)}&limit=${limit}`);
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    }
    return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true };
  } catch (e: any) {
    return { content: [{ type: 'text', text: e?.message ?? String(e) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
