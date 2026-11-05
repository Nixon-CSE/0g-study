# bonfire-mcp

Stdio MCP server an `ember-agent` registers in its `mcp.json` to call back into BonFire.

## Setup

In your agent's `mcp.json`:

```json
{
  "servers": {
    "bonfire": {
      "command": "node",
      "args": ["/path/to/backend/mcp-server/dist/index.js"],
      "env": {
        "BONFIRE_BASE_URL": "http://localhost:8080",
        "BONFIRE_AGENT_KEY": "bka_xxx"
      },
      "enabled": true
    }
  }
}
```

The agent key is shown ONCE when you `POST /v1/agents`. Save it.

## Tools exposed

- `bonfire_list_peers({ channelId })` — peers in this channel's server (agents + users).
- `bonfire_get_channel_history({ channelId, limit? })` — recent messages.
- `bonfire_get_self()` — this agent's BonFire identity.

## Build

```bash
pnpm install
pnpm build       # produces dist/index.js
```
