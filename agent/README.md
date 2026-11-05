# ember-agent

A standalone, Dockerizable AI agent service. One agent = one directory. OpenClaw-compatible skills, any OpenAI-compatible LLM, Telegram and a built-in web chat out of the box. Drop a config + a SOUL, ship an agent.

## Quickstart

```bash
cd agent && pnpm install
cp .env.example .env   # then fill in LLM_API_KEY
pnpm dev               # boots the example agent at examples/default-agent
```

Open `http://localhost:7777/chat` and talk to it.

## SOUL.md vs AGENTS.md

Both live inside the agent directory and are concatenated into the system prompt in this order:

- **`SOUL.md`** — voice and personality. Tone, vocabulary, banned phrases, humor rules. What the agent *sounds like*.
- **`AGENTS.md`** — operating rules. What it must/must not do, when to confirm, sourcing rules, refusal policy. What the agent *does*.

Keep each tight. Two short files beat one long one.

## LLM providers

Set `llm.provider` in `agent.config.json`. All three sit behind one `LanguageModelV1` surface, so agent code never branches on the provider.

| `llm.provider` | What | Configure |
| --- | --- | --- |
| `zerog-router` | **0G Private Computer** — OpenAI-compatible router at `https://router-api.0g.ai/v1`. Every call is traced and its request ID is attached to the reply. Used by the Study Pod agents. | `ZEROG_API_KEY` (from pc.0g.ai), `ZEROG_LLM_MODEL`, `ZEROG_VISION_MODEL`, optional `ZEROG_BASE_URL`. Check with `node scripts/smoke-router.mjs`. |
| `zerog` | 0G Compute broker — wallet-funded ledger, per-request signed headers. | `DEPLOYER_PRIVATE_KEY`, `OG_RPC_URL`, optional `OG_BROKER_PROVIDER` |
| `openai-compatible` | Any OpenAI-shaped endpoint. | `llm.baseUrl`, `llm.model`, key in `LLM_API_KEY` (or `llm.apiKeyEnv`) |

Examples of `openai-compatible` base URLs:

| Provider     | `llm.baseUrl`                  |
| ------------ | ------------------------------ |
| OpenAI       | `https://api.openai.com/v1`    |
| OpenRouter   | `https://openrouter.ai/api/v1` |
| Local vLLM   | `http://localhost:8000/v1`     |

Embeddings are configured separately (`EMBEDDINGS_*`); leave them blank to disable vector memory.

To try the Study Pod end to end against a running runtime: `node scripts/e2e-pod.mjs path/to/notes.jpg`.

## Telegram

1. Talk to [@BotFather](https://t.me/BotFather), `/newbot`, grab the token.
2. Set `TELEGRAM_BOT_TOKEN=<token>` in `.env`.
3. In `agent.config.json`, flip `channels.telegram.enabled` to `true`.
4. Restart. DM the bot or `@mention` it in a group.

DM access is controlled by `dmPolicy` (`open` | `allowlist` | `disabled`). Groups require a mention by default.

Built-in commands (subject to the same access rules): `/help`, `/status`, `/skills`, `/skills install <slug>` (security-scanned), `/skills remove <name>`, `/soul`, `/reset` (clears this chat's memory). Other slash commands go to the model. Replies show the 0G request IDs as a final `0G · …` line.

## Web chat

Served at `/chat` from `public/chat.html`. It's a single static file — edit it, theme it, or replace it entirely. The backend exposes:

- `GET /chat` — the HTML page
- `POST /chat/message` — submit a message
- `GET /chat/stream/:id` — SSE stream of the reply

## Skills

OpenClaw-compatible. A skill is a directory under `skills/<name>/` with a `SKILL.md`.

- **Filesystem**: drop a directory under `<agent>/skills/<name>/SKILL.md`. Hot-reloads.
- **Via API**: `POST /skills/install { "source": "agentskill.sh", "slug": "<owner>/<name>" }`. Other sources: `clawhub`, `url`.
- **Remove**: `DELETE /skills/<name>`.

Every install is run through the security scanner first. Findings are surfaced; criticals block.

## MCP servers

Edit `mcp.json` or call `POST /mcp/servers { id, command, args, env }`. Child processes are spawned on boot and their tools are merged into the registry.

## Built-in tools

Toggled per-agent under `tools.builtin` in `agent.config.json`, exposed to the model in the tool-use loop (MCP server tools are merged on top):

| Tool           | Config key    | Default | What it does                              |
| -------------- | ------------- | ------- | ----------------------------------------- |
| `web_fetch`    | `webFetch`    | on      | Fetch a URL                               |
| `web_search`   | `webSearch`   | off     | Tavily/Brave search (needs an API key)    |
| `code_exec`    | `codeExec`    | off     | Run code in a sandboxed subprocess        |
| file ops       | `fileOps`     | off     | Read/write files under a root dir         |
| `publish_site` | `publishSite` | on      | Publish a static site                     |
| `current_time` | `currentTime` | on      | Current date/time in any IANA timezone    |

## Evolution mode

In `agent.config.json` under `evolution.mode`:

- `off` — disabled.
- `suggest` *(default)* — discovers candidate skills and posts them to the control channel for review.
- `auto-safe` — auto-install if `securityScore >= 80` *and* the skill is pure-prompt (no code).
- `auto-all` — auto-install if `securityScore >= 50` and the scanner sees no critical findings.

> **Warning:** `auto-all` carries supply-chain risk. Public skills can prompt-inject even after scanning. Default to `suggest` unless you understand the risk.

## Admin API

No auth — assume network isolation. BonFire adds auth at its layer.

| Method | Path                          | Purpose                       |
| ------ | ----------------------------- | ----------------------------- |
| GET    | `/health`                     | liveness + uptime             |
| GET    | `/status`                     | rich status (model, channels, skills, memory) |
| GET    | `/skills`                     | list installed skills         |
| POST   | `/skills/install`             | install from source           |
| DELETE | `/skills/:name`               | remove a skill                |
| GET    | `/skills/discover`            | evolution discovery feed      |
| POST   | `/mcp/servers`                | register an MCP server        |
| DELETE | `/mcp/servers/:id`            | remove an MCP server          |
| GET    | `/config`                     | read merged config            |
| PATCH  | `/config`                     | mutate config                 |
| POST   | `/channels/telegram`          | runtime telegram control      |
| GET    | `/events`                     | SSE event stream              |
| GET    | `/chat`                       | built-in web chat UI          |
| POST   | `/chat/message`               | submit a chat message         |
| GET    | `/chat/stream/:id`            | SSE reply stream              |
| POST   | `/sessions/reset`             | clear a conversation          |

### `GET /status`

Read-only snapshot for monitoring and the wrapping product:

```json
{
  "ok": true, "name": "Ember", "id": "ember", "uptime": 42.1,
  "llm": { "provider": "openai-compatible", "model": "gpt-4o" },
  "channels": { "web": true, "telegram": false },
  "evolution": "suggest",
  "skills": { "count": 3, "names": ["learn", "..."] },
  "memory": { "sessions": 2, "messages": 10, "vectors": 4 }
}
```

### `POST /sessions/reset`

Clears the stored conversation (messages + memory vectors) for one session, keeping the session itself:

```bash
curl -X POST localhost:7777/sessions/reset \
  -H 'content-type: application/json' \
  -d '{ "chatId": "user-123", "channel": "web" }'
# -> { "ok": true, "cleared": 12 }
```

`channel` defaults to `"web"`; pass `topic` to target a sub-thread.

## Project layout

```
agent/
  src/
    api/         # Hono admin + chat routes
    channels/    # telegram, web
    config/      # zod schema + loader (SOUL/AGENTS)
    evolution/   # discover, score, loop
    memory/      # SQLite vector store
    runtime/     # session manager + prompt builder
    skills/      # loader, scanner, installer, registries
    tools/       # built-ins + MCP client + registry
    util/        # logger, path guard
    index.ts     # entrypoint
  examples/
    default-agent/   # mounted at /agent by docker
  public/
    chat.html        # built-in web chat
  docker/
    Dockerfile
    docker-compose.yml
  test/
```

## Docker

```bash
cd docker
docker compose up --build
```

Mounts `examples/default-agent` at `/agent` and exposes `:7777`.
