
A standalone **agent service**: one Docker-ready process that *is* one agent. Configured by a folder. Talks to Telegram. Eventually BonFire mounts many of these (or runs them in-process — that's the other dev's call).

### Core design principles
1. **Filesystem is the source of truth.** An agent = a directory. You can `cp -r` it to clone, `git commit` it to version, `tar` it to ship.
2. **OpenClaw conventions, not OpenClaw the package.** We borrow the file names and format spec so skills from ClawHub/agentskill.sh/skills.sh just work.
3. **OpenAI-compatible LLM client, no provider lock-in.** Base URL + API key + model name. Works with OpenAI, OpenRouter, 0G Compute's router, your local vLLM, anything.
4. **Channel adapters are plugins.** Telegram is the first one. WhatsApp, Discord, BonFire-internal will be drop-in modules implementing the same interface.
5. **Self-evolution gated by policy.** "Auto-install skills from skill.sh" is dangerous if unbounded — we make it a configurable mode (`off` / `suggest` / `auto-safe` / `auto-all`) with a security scanner pass before any install. Default: `suggest`.

### Agent directory layout
```
my-agent/
├── agent.config.json         # core config (model, channels, registry, evolution mode)
├── SOUL.md                   # personality (the OpenClaw-style voice file)
├── AGENTS.md                 # operating rules (separate from voice, per OpenClaw guidance)
├── .env                      # secrets (TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, etc.)
├── skills/                   # installed skills (one folder each, SKILL.md inside)
│   ├── web-search/
│   │   └── SKILL.md
│   └── github/
│       └── SKILL.md
├── mcp.json                  # MCP server configurations
├── memory/                   # vector store + session logs (gitignored)
└── logs/                     # runtime logs (gitignored)
```

### Component breakdown

| Component | What it does | Tech |
|---|---|---|
| **Core runtime** | Boots agent, loads SOUL/AGENTS/skills, owns the agent loop | TypeScript, Node 20+ |
| **LLM client** | OpenAI-compatible HTTP client, streaming, tool calls, retries | Vercel AI SDK (`ai` + `@ai-sdk/openai`) — works with any OpenAI-compatible endpoint |
| **Prompt builder** | Composes system prompt from SOUL.md + AGENTS.md + skills XML + tool defs | Custom |
| **Skill loader** | Scans `skills/`, parses YAML frontmatter, gating, hot-reload | Custom, AgentSkills-compatible |
| **Skill installer** | Pulls skills from registries (ClawHub / skills.sh / agentskill.sh) with security scan | Custom — calls registry CLIs as subprocess for v1 |
| **MCP client** | Connects to MCP servers listed in `mcp.json`, exposes tools | Official `@modelcontextprotocol/sdk` |
| **Tool registry** | Built-in tools (web search, fetch, code exec sandbox, file ops) + MCP tools + skill tools | Custom |
| **Channel adapter — Telegram** | grammY-based, long polling default, webhook optional, per-agent bot token | `grammy` |
| **Channel adapter — interface** | Base class so WhatsApp/Discord/BonFire just implement `onMessage`/`send` | Custom |
| **Memory** | Per-agent vector store + structured logs | SQLite + `sqlite-vec` for v1 (no external deps) |
| **Evolution loop** | Periodic scan of configured registries, proposes skills, installs per policy | Custom, cron-style |
| **Admin HTTP API** | `/skills/install`, `/skills/list`, `/config`, `/health`, `/status` — for BonFire to drive | Hono (lightweight) |

### What "OpenAI-compatible LLM" means in practice
The Vercel AI SDK's `@ai-sdk/openai-compatible` package lets you configure any endpoint:
```ts
createOpenAICompatible({
  baseURL: process.env.LLM_BASE_URL,    // e.g. https://openrouter.ai/api/v1
  apiKey: process.env.LLM_API_KEY,
  name: 'configured-provider',
});
```
So you can swap to OpenRouter, Together, Groq, or 0G's `router-api.0g.ai/v1` by changing env vars. No code change.

### Telegram per-agent binding
Each agent instance owns one Telegram bot token. Multi-agent on the same Telegram is *not* a v1 concern — BonFire will spawn N agent processes, each with its own token. This matches how Telegram works: one token = one bot. Long polling default; webhook switchable for prod.

### Self-evolution flow
1. **Discover** — every N hours (configurable, default 24h), query configured registries for skills tagged with the agent's interest tags (declared in `agent.config.json`).
2. **Score** — rank by: install count, security scan status, semantic match against agent's recent work (using the LLM as judge).
3. **Act per policy:**
   - `off`: do nothing
   - `suggest`: post top candidates to a configured "control" channel for human approval
   - `auto-safe`: auto-install only if security scan is clean *and* skill has no `requires.bins`/`env` (pure prompt skills)
   - `auto-all`: auto-install if security scan passes (still blocks `critical` findings)
4. **Workshop mode** (optional, inspired by OpenClaw's Skill Workshop): observe the agent's own successful workflows and propose new skills derived from them. Off by default.

### Admin HTTP API surface (for BonFire integration)
```
POST   /skills/install     { source: "agentskill.sh" | "clawhub" | "url", slug | url }
DELETE /skills/:name
GET    /skills             list installed
GET    /skills/discover    list candidates from registries
POST   /mcp/servers        add MCP server
DELETE /mcp/servers/:id
GET    /config             current config (redacted)
PATCH  /config             update specific keys (model, evolution mode, etc.)
POST   /channels/telegram  { botToken, dmPolicy, allowFrom }
GET    /health
GET    /status             running, last activity, token usage, costs
WS     /events             stream of agent activity (for BonFire's UI)
```

### What I'm *not* building in v1 (be explicit)
- Multi-agent orchestration *inside* one process (BonFire handles that across processes)
- Voice (LiveKit) — that's BonFire's job per the PRD
- Web UI — BonFire is the UI; v1 is HTTP API only
- Authentication on the admin API — assumed network-isolated; BonFire adds auth at its layer
- Fancy memory engines (Honcho, QMD, LanceDB) — start with SQLite + `sqlite-vec`, swap later
- WhatsApp/Discord/etc. channels — Telegram only, but adapter interface ready

### Key risks I want to flag now
1. **Self-evolution from public registries = supply chain risk.** Even with scanning, an auto-installed skill can prompt-inject. Default to `suggest`, never `auto-all`. Make this loud in the README.
2. **Memory size grows unbounded.** Need rotation/compaction in v1 or this dies in week 2.
3. **Per-agent Telegram token means rate limits stack per agent, not per platform.** Not a blocker, just be aware.
4. **MCP server processes are spawned children.** Resource limits matter — one runaway MCP server kills the agent. Use child process limits.

---

## The Claude Code prompt

Paste everything below into Claude Code. Run it in an empty directory.

```
Build a standalone AI agent service called "ember-agent" (working name — easy to rename later). This will eventually plug into a larger platform called BonFire, but for now it's a self-contained service.

## Stack
- TypeScript, Node 20+, pnpm
- Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`) for LLM
- `grammy` for Telegram
- `@modelcontextprotocol/sdk` for MCP
- `hono` for the admin HTTP API
- `better-sqlite3` + `sqlite-vec` for memory
- `zod` for config validation
- `pino` for logging
- `dotenv` for env loading
- `chokidar` for hot-reloading skill files
- `gray-matter` for parsing SKILL.md YAML frontmatter

## Project structure to create
```
ember-agent/
├── package.json
├── tsconfig.json
├── README.md
├── .env.example
├── .gitignore
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── src/
│   ├── index.ts              # entrypoint: loads config, boots runtime, starts adapters
│   ├── runtime/
│   │   ├── agent.ts          # AgentRuntime class — core loop
│   │   ├── prompt-builder.ts # composes system prompt from SOUL/AGENTS/skills/tools
│   │   ├── llm-client.ts     # OpenAI-compatible client wrapper
│   │   └── session.ts        # per-channel session state, history, compaction
│   ├── skills/
│   │   ├── loader.ts         # scans skill dirs, parses frontmatter, gating
│   │   ├── installer.ts      # pulls from registries with security scan
│   │   ├── workshop.ts       # (stub for now) generate skills from observed work
│   │   ├── scanner.ts        # dangerous-code scanner (regex-based v1)
│   │   └── registry-clients/
│   │       ├── base.ts
│   │       ├── agentskill-sh.ts   # default
│   │       ├── clawhub.ts
│   │       └── skills-sh.ts
│   ├── tools/
│   │   ├── registry.ts       # merges built-in, MCP, and skill-derived tools
│   │   ├── builtin/
│   │   │   ├── web-search.ts # via Tavily/Brave (configurable)
│   │   │   ├── web-fetch.ts
│   │   │   ├── code-exec.ts  # sandboxed via subprocess + timeout
│   │   │   └── file-ops.ts
│   │   └── mcp-client.ts     # connects/manages MCP server child processes
│   ├── channels/
│   │   ├── base.ts           # Channel interface
│   │   └── telegram.ts       # grammY adapter
│   ├── memory/
│   │   ├── store.ts          # SQLite + sqlite-vec wrapper
│   │   └── embeddings.ts     # uses OpenAI-compatible embeddings endpoint
│   ├── evolution/
│   │   ├── discover.ts       # scan registries
│   │   ├── score.ts          # LLM-as-judge ranking
│   │   └── loop.ts           # cron-style scheduler
│   ├── api/
│   │   ├── server.ts         # Hono app
│   │   └── routes/
│   │       ├── skills.ts
│   │       ├── mcp.ts
│   │       ├── config.ts
│   │       ├── channels.ts
│   │       ├── health.ts
│   │       └── events.ts     # WebSocket stream
│   └── config/
│       ├── schema.ts         # Zod schemas
│       ├── loader.ts         # reads agent.config.json + .env + SOUL.md + AGENTS.md
│       └── defaults.ts
├── examples/
│   └── default-agent/
│       ├── agent.config.json
│       ├── SOUL.md
│       ├── AGENTS.md
│       ├── mcp.json
│       └── skills/
│           └── .gitkeep
└── test/
    ├── runtime.test.ts
    ├── skills-loader.test.ts
    ├── prompt-builder.test.ts
    └── channel-telegram.test.ts
```

## File format requirements

### `agent.config.json` schema
```json
{
  "name": "string (display name)",
  "id": "string (slug, kebab-case)",
  "llm": {
    "baseUrl": "string (e.g. https://api.openai.com/v1)",
    "model": "string (e.g. gpt-4o-mini)",
    "apiKeyEnv": "string (env var name holding the key, default: LLM_API_KEY)",
    "temperature": "number (default 0.7)",
    "maxTokens": "number (default 4096)"
  },
  "embeddings": {
    "baseUrl": "string",
    "model": "string",
    "apiKeyEnv": "string"
  },
  "channels": {
    "telegram": {
      "enabled": "boolean",
      "tokenEnv": "string (default: TELEGRAM_BOT_TOKEN)",
      "dmPolicy": "open | allowlist | pairing | disabled",
      "allowFrom": "string[] (numeric Telegram user IDs)",
      "groups": { "<chatId>": { "requireMention": "boolean", "allowFrom": "string[]" } }
    }
  },
  "mcp": {
    "configFile": "string (default: ./mcp.json)"
  },
  "evolution": {
    "mode": "off | suggest | auto-safe | auto-all (default: suggest)",
    "intervalHours": "number (default: 24)",
    "registries": "string[] (e.g. ['agentskill.sh'])",
    "interests": "string[] (tags to match against; default: derived from SOUL.md)",
    "controlChannel": "string (where to post suggestions; e.g. 'telegram:<chatId>')"
  },
  "memory": {
    "maxSessions": "number (default 100)",
    "compactAfterTokens": "number (default 8000)",
    "vectorStorePath": "string (default ./memory/vectors.db)"
  },
  "tools": {
    "builtin": {
      "webSearch": { "enabled": "boolean", "provider": "tavily | brave", "apiKeyEnv": "string" },
      "webFetch": { "enabled": "boolean" },
      "codeExec": { "enabled": "boolean", "timeoutMs": "number" },
      "fileOps": { "enabled": "boolean", "rootDir": "string" }
    }
  },
  "logging": {
    "level": "trace | debug | info | warn | error",
    "logDir": "string (default ./logs)"
  }
}
```

### `SOUL.md` — exactly the OpenClaw convention
Free-form markdown defining voice/tone/opinions/humor/boundaries. No frontmatter required. Loaded verbatim into the high-priority system prompt section. Include a placeholder template in `examples/default-agent/SOUL.md` that follows the OpenClaw "good SOUL.md" guidance — concise, opinionated, no corporate sludge. Use the "Molty prompt" guidance: no "Great question," / "I'd be happy to help," / "Absolutely." openers; brevity mandatory; opinions allowed; humor when it lands.

### `AGENTS.md` — operating rules
Separate file for behavioral rules that aren't voice — tool usage policies, when to ask clarifying questions, security guidance, default workflows. Loaded after SOUL.md in the system prompt.

### `SKILL.md` — AgentSkills-compatible
Parse YAML frontmatter with these keys:
- `name` (required, string)
- `description` (required, string)
- `metadata.openclaw.requires.bins` (string[])
- `metadata.openclaw.requires.env` (string[])
- `metadata.openclaw.requires.anyBins` (string[])
- `metadata.openclaw.always` (boolean)
- `user-invocable` (boolean, default true)
- `disable-model-invocation` (boolean, default false)

Skills are scanned from `<agent>/skills/<skill-name>/SKILL.md`. Support hot reload via chokidar.

### `mcp.json`
```json
{
  "servers": {
    "<server-id>": {
      "command": "string",
      "args": "string[]",
      "env": { "KEY": "value" },
      "enabled": "boolean"
    }
  }
}
```

## Runtime behavior

### Boot sequence
1. Load `.env`
2. Load and validate `agent.config.json` with Zod
3. Load `SOUL.md` and `AGENTS.md` (raw markdown)
4. Scan `skills/` and build skill registry
5. Read `mcp.json` and spawn enabled MCP server children, collect their tools
6. Initialize built-in tools per config
7. Initialize memory (SQLite + sqlite-vec)
8. Start enabled channel adapters
9. Start admin HTTP API on port from env (`AGENT_API_PORT`, default 7777)
10. Start evolution loop if mode != "off"
11. Log "ready" with summary

### Agent loop (per message)
1. Receive inbound message via channel adapter
2. Check access controls (allowFrom, etc.)
3. Load/create session for `<channel>:<chatId>:[topic]`
4. Retrieve relevant memory (top-k vector search on user message)
5. Build system prompt: `<SOUL.md>` + `<AGENTS.md>` + `<eligible-skills-XML>` + `<retrieved-memory>` + `<tool-descriptions>`
6. Call LLM with tool definitions (built-in + MCP + skill commands)
7. Handle tool calls in a loop until model returns final text
8. Stream response to channel adapter (Telegram supports preview editing per the docs)
9. Persist turn to memory; embed and index
10. Run session compaction if over token budget

### Prompt structure (compose in this order)
```
<system>
You are {agent.name}.

<soul>
{SOUL.md contents verbatim}
</soul>

<operating_rules>
{AGENTS.md contents verbatim}
</operating_rules>

<available_skills>
{XML list of eligible skills following OpenClaw's formatSkillsForPrompt format: <name>, <description>, <location> per skill}
</available_skills>

<available_tools>
{tool descriptions; the SDK handles tool calling syntax}
</available_tools>

<memory_context>
{top-k retrieved memories, if any}
</memory_context>
</system>
```

### Telegram adapter requirements
- Use grammy with long polling default
- Read bot token from env var named in config (default `TELEGRAM_BOT_TOKEN`)
- Respect `dmPolicy` and `allowFrom`
- Group support with `requireMention` default true
- Streaming preview edits using `editMessageText` while LLM generates
- Send markdown-converted-to-HTML, fallback to plain text on parse failure
- Implement these built-in slash commands: `/help`, `/status`, `/skills`, `/skills install <slug>`, `/skills remove <name>`, `/soul` (shows current SOUL.md), `/reset` (clears current session memory)
- Pass other slash commands to the model

### Skill installation flow
For agentskill.sh:
1. `POST /skills/install { source: "agentskill.sh", slug: "<slug>" }`
2. Invoke `npx @agentskill.sh/cli@latest install <slug> --target ./skills` as subprocess
3. Run security scanner on resulting `SKILL.md` (regex-based checks: shell exec patterns, credential exfil patterns, network calls in install hooks)
4. If scan fails: refuse and report
5. If scan passes: trigger hot reload of skills, respond with success

For ClawHub:
1. Use `openclaw skills install <slug>` if `openclaw` CLI is on PATH, otherwise fetch from clawhub.ai HTTPS API
2. Same scan + reload flow

For URL/Git:
1. Clone or download to temp dir
2. Scan
3. Move to `skills/<slug>/` on pass

### Evolution loop
Every `intervalHours`:
1. For each configured registry, query for skills matching `interests` tags
2. Filter out already-installed
3. Score top 20 via LLM-as-judge: send name + description + agent's recent work summary, ask "would this be useful (0-10) and why"
4. Take top 3
5. Per `mode`:
   - `suggest`: post to `controlChannel` with install buttons (Telegram inline keyboard)
   - `auto-safe`: install if scan clean AND skill has no `requires.bins`/`env`
   - `auto-all`: install if scan clean (no critical findings)
6. Log everything

### Security scanner (v1, regex-based)
Flag and `critical`-block these patterns in skill content and any embedded scripts:
- `curl ... | sh` or `wget ... | sh`
- `rm -rf /` patterns
- Outbound calls to non-allowlisted domains in install hooks
- Hardcoded keys (`sk-`, `xoxb-`, AWS-style patterns)
- `eval()` of remote content

Warn (non-blocking) on:
- `child_process.exec` calls
- Filesystem writes outside skill directory

### Memory
- SQLite database at `memory/agent.db`
- Tables: `sessions`, `messages`, `vectors` (using sqlite-vec)
- Embeddings via OpenAI-compatible embeddings endpoint (config'd separately from chat LLM)
- Retrieve top-5 by cosine similarity on user message, scoped to current session + optionally cross-session
- Compaction: when session message count > threshold, summarize older half into a single "context summary" message, delete originals

## Testing requirements
- Unit tests for: config loader, skill loader (frontmatter parsing, gating), prompt builder, security scanner
- Integration test for Telegram adapter using grammy's testing utilities
- Mock LLM client for runtime tests
- Test fixture agent under `test/fixtures/test-agent/`

## Documentation requirements
README.md must include:
- Quickstart: clone, copy `.env.example`, configure SOUL.md, run
- How to add a Telegram bot token (BotFather steps)
- How to point at different LLM providers (OpenAI, OpenRouter, 0G Compute, local)
- How to add/remove skills via API and via filesystem
- How to add an MCP server
- Security warning about evolution mode = auto-all
- Explanation of SOUL.md vs AGENTS.md (voice vs operating rules)

## Constraints
- NO browser-only code, this is a Node service
- NO authentication on the admin API yet (assume network-isolated for v1; document this loudly)
- All secrets via env vars only, NEVER in committed config
- All file I/O scoped to agent directory; refuse paths that escape it (realpath check, like OpenClaw does for skills)
- Logs must never contain bot tokens, API keys, or full message content of restricted channels
- Telegram bot token rotation must be possible without code change (env reload + adapter restart)
- Process must handle SIGTERM gracefully: stop accepting messages, finish in-flight turns, flush memory, exit

## What NOT to build right now
- Voice (LiveKit) — separate concern
- Web UI — BonFire handles it
- Authentication / auth on admin API
- WhatsApp / Discord / Slack channels (interface yes, implementation no)
- Multi-agent orchestration inside one process
- Honcho/QMD/LanceDB — basic SQLite memory only

## Deliverables
1. Working code in the structure above
2. `pnpm install && pnpm test && pnpm dev` should boot a working agent against the example
3. Docker image that runs the example agent with mounted volume for `<agent-dir>`
4. README that gets a new dev from clone → first Telegram reply in under 10 minutes

Start by creating the directory structure and `package.json`, then implement bottom-up: config loader → SOUL/AGENTS parsing → LLM client → tool registry → prompt builder → runtime loop → Telegram adapter → admin API → skills installer → evolution loop. Write tests as you go.
```
 

## Skill registry: agentskill.sh

The default skill registry is agentskill.sh. Its integration model is NOT a 
custom CLI wrapper — it's a meta-skill called `/learn` that, once installed, 
gives the agent the ability to search, install, update, and remove other 
skills via natural-language commands during a conversation.

### Bootstrap step (first boot)
On first run, if `skills/learn/SKILL.md` does not exist:
1. Run `git clone https://github.com/agentskill-sh/ags.git skills/learn` 
   (use HTTPS so it works without SSH keys).
2. Log: "Installed /learn skill from agentskill.sh — agent can now search 
   and install skills autonomously."
3. If git is not on PATH, fall back to fetching the SKILL.md directly via 
   HTTPS from the raw GitHub URL.

The `/learn` skill is then loaded by the normal skill loader and surfaced 
to the LLM like any other skill. The LLM can invoke it via tool calling 
(or slash command, depending on how the skill declares command-dispatch).

### Skills directory format
Every skill installed by `/learn` includes a metadata header at the top of 
`SKILL.md`:
--- agentskill.sh ---
slug: <slug>
owner: <owner>
contentSha: <sha>
installed: <iso-timestamp>
source: https://agentskill.sh/<owner>/<slug>
---

The skill loader MUST tolerate this header — strip it before parsing the 
YAML frontmatter underneath. Persist the contentSha and source URL into 
the in-memory skill record so the admin API can report installed versions 
and detect drift.

### Admin API skill install endpoint
`POST /skills/install` accepts:
{ "slug": "<owner>/<name>" }            // canonical form, e.g. "anthropics/docx"
{ "query": "<free-text>" }              // fuzzy search; installs top match
{ "skillset": "<slug>" }                // installs a whole bundle
{ "owner": "<user>" }                   // installs all skills by an owner

Implementation: the admin route triggers an agent turn with a synthetic 
user message that invokes `/learn`, e.g. `/learn @anthropics/docx` or 
`/learn skillset:frontend-essentials`. Wait for the agent to complete the 
install (the `/learn` skill writes to `skills/<slug>/SKILL.md`). Hot 
reload picks up the new file. Return the installed slug + contentSha.

Alternative path (use when the LLM-driven install would be wasteful, e.g. 
deterministic admin-triggered installs): call the agentskill.sh public 
API directly. The exact endpoints are NOT documented in the public site; 
read the live `/learn` SKILL.md at 
https://raw.githubusercontent.com/agentskill-sh/ags/main/SKILL.md to 
extract the URLs it uses, then mirror them in our installer code. Document 
clearly in code comments that these URLs are derived from the /learn 
source and may change — if they break, re-read the source.

The LLM-driven path is the safer default for v1. Direct-API can be added 
in v1.1 once the endpoints are pinned.

### Security gating (enforce in our scanner regardless of /learn's checks)
agentskill.sh exposes a `securityScore` (0-100) per skill, scanned 
server-side across 12 threat categories. The `/learn` skill ALREADY warns 
at <50 and confirms at <30. We add a second layer:

- `auto-safe` mode: refuse install if `securityScore < 80` OR if skill 
  declares any `metadata.openclaw.requires.bins` or `requires.env` 
  (pure-prompt skills only).
- `auto-all` mode: refuse install if `securityScore < 50` OR any 
  `critical` finding from our local regex scanner.
- `suggest` mode (default): post candidates with their securityScore to 
  the control channel; human approves install.

Surface the securityScore in the `GET /skills` and `GET /skills/discover` 
responses so BonFire's UI can render the badge.

### Evolution loop, revised
Every `intervalHours`:
1. Pick a random subset of `interests` tags (don't query all at once — 
   spread load on the registry).
2. For each, issue a synthetic agent turn: `/learn <interest> --json` 
   (the /learn skill returns top matches; if --json isn't supported, 
   parse its natural-language response).
3. Filter out already-installed slugs (track by `<owner>/<slug>` from the 
   metadata header).
4. Score remaining via LLM-as-judge as before.
5. Take top 3 and act per `mode` with the gating above.

### Manage commands (proxied to /learn)
The Telegram adapter's built-in slash commands map to /learn:
- `/skills`            → `/learn list`
- `/skills install <q>` → `/learn <q>`
- `/skills remove <slug>` → `/learn remove <slug>`
- `/skills update`     → `/learn update`

These are convenience aliases. The Telegram handler intercepts these, 
invokes the agent with the corresponding `/learn` command, and streams 
the response.