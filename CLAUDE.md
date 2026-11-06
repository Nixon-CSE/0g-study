# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

Buildable trees plus product docs. A pnpm workspace ([pnpm-workspace.yaml](pnpm-workspace.yaml)) ties together **`agent`, `backend`, and `contracts`**; `app` and `web` are standalone npm trees outside the workspace.

- [agent/](agent/) — `ember-agent`, the standalone agent runtime (TypeScript/Node, pnpm, Dockerizable). Self-contained, one agent directory per process; that process can also serve several personas as *tenants* (`data/tenants.json`, `/tenants` API, or inline payloads from the backend). (workspace pkg: `ember-agent`)
- [backend/](backend/) — `bonfire-backend`, the Hono HTTP server (Node ≥ 20, pnpm). MongoDB persistence, 0G-chain INFT gate, Daily.co voice, Privy auth. Vitest tests run in-process via `mongodb-memory-server` + `OG_STORAGE_MOCK=1`. (workspace pkg: `bonfire-backend`)
- [contracts/](contracts/) — `bonfire-contracts`, a Hardhat Solidity project. `BonFireAgentINFT` (ERC-721 soulbound INFT with encrypted metadata + usage authorization); ABI is exported to `contracts/abi/` and consumed by backend + app. (workspace pkg: `bonfire-contracts`)
- [app/](app/) — the BonFire wrapper UI (Next.js 14, **npm**). The marketplace + workspace surfaces that consume the agent runtime. Deployed on Vercel ([vercel.json](vercel.json), `installCommand: npm install`).
- [web/](web/) — **legacy** React 17 Discord-UI-clone client (npm, `react-app-rewired`). Not in the workspace, not deployed; kept as reference. Prefer `app/` for any new UI work.
- [scripts/](scripts/) — `verify-inft-integration.sh`, the cross-package smoke check (contracts + backend + agent + app) used as the basis for CI.

CI lives in [.github/workflows/ci.yml](.github/workflows/ci.yml): a `workspace` job (agent/backend/contracts typecheck + test) and an `app` job (install + typecheck + vitest + lint).

`bonfire` is the umbrella product; `ember-agent` is what BonFire wraps. Top-level files ([prd.md](prd.md), [agent-prd.md](agent-prd.md), [resources.md](resources.md), [submission.md](submission.md)) are product/design context for the hackathon submission, not code.

## Commands

### Agent runtime (from [agent/](agent/), Node ≥ 20, pnpm)

```bash
pnpm install
pnpm dev            # tsx watch on src/index.ts; passes examples/default-agent as argv[2] (bypasses $AGENT_DIR fallback)
pnpm build          # tsc -> dist/
pnpm start          # node dist/index.js (expects an agent dir as $AGENT_DIR or argv[2])
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run
pnpm test:watch
pnpm test -- test/runtime.test.ts            # single file
pnpm test -- -t "handles a message"          # by test name
```

Docker (from `agent/docker/`): `docker compose up --build` — builds the image, mounts `examples/default-agent` at `/agent`, exposes `:7777`. The image bakes in `data/` and `examples/` and copies `examples/default-agent` to `/agent`; the ENTRYPOINT runs `node dist/index.js "$AGENT_DIR"` (default `/agent`). The port is `AGENT_API_PORT`, else `PORT` (set by container hosts), else 7777.

`.env` lives at `agent/.env` (see `.env.example`). The compose file reads `../.env`, so the same file works for both `pnpm dev` and Docker.

### App (from [app/](app/), npm)

```bash
npm install
npm run dev         # next dev (default :3000)
npm run build       # next build
npm run start       # next start
npm run lint        # eslint (flat config, eslint-config-next)
```

The app is npm-based (`package-lock.json`); the agent/backend/contracts share the root pnpm workspace (`pnpm-lock.yaml`). Don't mix package managers across a tree.

### Backend (from [backend/](backend/), Node ≥ 20, pnpm)

```bash
pnpm install                       # or from repo root (workspace)
pnpm dev                           # tsx watch on src/index.ts (needs Docker for Mongo)
pnpm dev:no-docker                 # DEV_MEMORY_MONGO=1 — in-process Mongo
pnpm typecheck                     # tsc --noEmit
OG_STORAGE_MOCK=1 pnpm test        # vitest run, in-process Mongo + mocked 0G storage
```

### Contracts (from [contracts/](contracts/), Hardhat, pnpm)

```bash
pnpm build                         # hardhat compile && copy ABI to contracts/abi/
pnpm test                          # hardhat test
pnpm deploy:ogtestnet              # DEPLOYER_PRIVATE_KEY=0x... required
```

### Cross-package + CI

```bash
bash scripts/verify-inft-integration.sh   # contracts + backend + agent + app smoke check
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the equivalent checks on push/PR. Pin: `pnpm 9`, Node 20; the app job uses `npm install` (parity with Vercel) since `package-lock.json` isn't pinned for `npm ci`.

## Architecture

### Boot flow ([src/index.ts](agent/src/index.ts))

`main()` resolves an **agent directory** (argv[2] / `$AGENT_DIR` / `./examples/default-agent`) and wires everything against that directory — not the cwd. The agent directory is the unit of configuration; it contains `agent.config.json`, `SOUL.md`, `AGENTS.md`, `mcp.json`, and `skills/`. Treat `agentDir` as the only filesystem root the runtime should touch — paths outside it must go through [src/util/paths.ts](agent/src/util/paths.ts)'s `assertInside`.

Boot order matters: load config → bootstrap `/learn` skill → load filesystem skills (and start watcher) → start MCP child processes → create LLM client (may do network/on-chain work for 0G) → open `MemoryStore` (JSON snapshot file + in-memory vectors) → construct `AgentRuntime` → start channel adapters (web, telegram) → start evolution loop → start HTTP API. SIGTERM/SIGINT teardown reverses this.

### LLM provider abstraction ([src/runtime/llm-client.ts](agent/src/runtime/llm-client.ts))

Three providers, one `LanguageModelV1` surface from Vercel AI SDK:

- **`zerog-router`** — 0G Private Computer, the OpenAI-compatible router at `https://router-api.0g.ai/v1` ([src/providers/zerog-router.ts](agent/src/providers/zerog-router.ts)). Key `ZEROG_API_KEY`, models `ZEROG_LLM_MODEL` / `ZEROG_VISION_MODEL`. Every call goes through a traced `fetch` that records request ID, status and tokens into the per-turn `AsyncLocalStorage` context; the runtime appends a `⟦0g:…⟧` marker to the reply. `chat_template_kwargs` (thinking off) is only sent to open-weight families — hosted models reject it. Used by the Study Pod.

- **`openai-compatible`** — any OpenAI-shaped chat endpoint. Reads `LLM_API_KEY` (env var name is configurable per agent via `llm.apiKeyEnv`).
- **`zerog`** — 0G Compute network. Constructs an `ethers.Wallet` from `DEPLOYER_PRIVATE_KEY`, instantiates `@0glabs/0g-serving-broker`, ensures a ledger exists (auto-funds 0.05 OG), lists chat services, picks one (honoring `OG_BROKER_PROVIDER` preference and `llm.model` pin), and wraps the OpenAI-compatible adapter with a custom `fetch` that injects per-request signed headers from `broker.inference.getRequestHeaders()`. The broker SDK is CommonJS — loaded via `createRequire` to avoid ESM interop bugs.

When adding LLM features, write against `LanguageModelV1` from `ai` — never branch on provider. Provider differences end at this file.

### Prompt composition ([src/runtime/prompt-builder.ts](agent/src/runtime/prompt-builder.ts))

The system prompt is assembled from four sources, in this XML structure: `<soul>` (from `SOUL.md` — voice/personality) + `<operating_rules>` (from `AGENTS.md` — must/must-not rules) + `<available_skills>` (loaded skills, name+description+path) + `<memory_context>` (top-k vector hits for the current message). SOUL and AGENTS are deliberately split — keep edits in the right file. Do not merge them.

### Message lifecycle ([src/runtime/agent.ts](agent/src/runtime/agent.ts))

`AgentRuntime.handle(InboundMessage)`:
1. `SessionManager.load({channel, chatId})` — gets or creates a session row keyed by `(channel, chat_id, topic)`; loads recent message history.
2. If embeddings configured, embed the user text and pull top-5 vector hits → `memorySnippets`.
3. Build system prompt; call `generateText` with `maxSteps: 8` (tool-use loop).
4. Reply via the channel's `msg.reply()`; append user+assistant turns to the memory store; re-embed the exchange and index it.
5. `maybeCompact` deletes oldest messages when token usage crosses `memory.compactAfterTokens` and the row count exceeds 40.

Channels (`web`, `telegram`) implement the `ChannelAdapter` interface in [src/channels/base.ts](agent/src/channels/base.ts) and converge on the same `InboundMessage` shape — `reply` is a function the channel provides. The web adapter is also the SSE bus for `/chat/stream/:id`.

### Skills ([src/skills/](agent/src/skills/))

A skill is `<agentDir>/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, optional `metadata.openclaw.*` for gating). Loader strips an optional `--- agentskill.sh ---` block above the frontmatter that carries registry provenance (`owner`, `slug`, `contentSha`). `chokidar` watches the skills dir and triggers a full reload on any change — the loader is idempotent, so just re-running it is the refresh.

`installSkill` (in [installer.ts](agent/src/skills/installer.ts)) routes through one of three registry clients (`agentskill.sh`, `clawhub`, `url`), runs `scanner.scanContent` on the resulting `SKILL.md`, and **deletes the install on any critical finding**. `auto-safe` evolution mode additionally rejects skills declaring `requires.bins`.

`removeSkill` validates the slug against `/^[A-Za-z0-9._-]+$/` *and* runs `assertInside(skillsRoot, slug)` before `rm -rf`. **Any new code that resolves user-supplied paths under `agentDir` must go through `assertInside`** — `realpath`-based, tolerates non-existent targets, blocks symlink escape.

On first boot, `ensureLearnSkill` clones the `agentskill.sh/ags` repo into `skills/learn/` (falls back to a single-file HTTPS fetch of `SKILL.md` if git fails). This is what lets the agent install other skills via natural language.

### Evolution loop ([src/evolution/loop.ts](agent/src/evolution/loop.ts))

Periodically (every `evolution.intervalHours`) calls `discover(interests)` against `agentskill.sh`, scores candidates with the LLM (0-10 JSON output), then either emits a `evolution.suggest` event on the bus (`mode: suggest`) or auto-installs (`auto-safe` requires `securityScore >= 80`, `auto-all` requires `>= 50`). `auto-all` is documented as supply-chain-risky — default is `suggest`.

### HTTP API ([src/api/](agent/src/api/))

Hono app composed from feature routers in `src/api/routes/*.ts`. Generally no auth — assume network isolation; BonFire adds auth at its layer, so don't add auth to admin/chat routes here. **One exception:** the Study Pod routes the *browser* calls directly (`/uploads`, `/usage`, `/study/*`, including `/study/recall`) go through `studyAuth` ([src/study/auth.ts](agent/src/study/auth.ts)), which verifies a backend-issued HS256 study token (`GET /v1/auth/study-token`) with `STUDY_JWT_SECRET` (= backend `JWT_SECRET`); unset means open dev mode. `/study/account` (FR9, flag `ZEROG_USER_ACCOUNTS=on`) stores a user's own `sk-`/`mk-` 0G keys encrypted ([src/study/zerog-account.ts](agent/src/study/zerog-account.ts)); the runtime puts the `sk-` key in the turn's request context and `withUserKey` swaps it into router calls. Never return or log these keys.

The admin gate ([src/api/admin-auth.ts](agent/src/api/admin-auth.ts), `AGENT_ADMIN_TOKEN`) covers `/mcp`, `/config`, `/tenants`, `/skills`, `/channels`, `/sessions`, `/events` and `/rag`. `/chat/message` honours a `studentId` only with that token (the backend sends it via `agentFetch`), since `studentId` selects whose study data and notes a turn can read.

### Study memory / RAG ([src/rag/](agent/src/rag/))

0G embeddings (`POST /v1/embeddings`, `ZEROG_EMBED_MODEL`, default `qwen3-embedding-0.6b`) through `routerFetch`, so they are traced and capped like chat. `chunk.ts` (pure), `embed.ts` (typed `EmbeddingError`, no fallback provider), `store.ts` (one JSON index per owner, `study/<userId>/rag.json` or `rag/kb/<serverId>.json`, model and dimension pinned, `withFileLock` + write-then-rename), `search.ts` (pure `rankChunks`, untrusted `formatRetrievedBlock`). `read_notes` indexes each transcription and `recall_notes` searches the turn's student only. The backend's knowledge block comes from the admin routes `/rag/kb/{index,delete,search}` ([backend/src/agents/kb-rag.ts](backend/src/agents/kb-rag.ts)) and falls back to the newest docs. Never log note text or vectors.

The chat UI is a single static file at [agent/public/chat.html](agent/public/chat.html) served verbatim by `GET /chat`. It is intentionally hand-editable — don't replace it with a build pipeline.

### Memory store ([src/memory/store.ts](agent/src/memory/store.ts))

A dependency-free store: sessions, messages and vectors live in memory and are flushed (debounced) to a JSON snapshot at `memory.vectorStorePath`; vector search is brute-force cosine. Vector dim defaults to 1536 (constructor argument) — if you change the embeddings model dimension, change it and discard old snapshots.

## Conventions

- **ESM throughout.** Imports use `.js` extensions even for `.ts` source — required for Node's NodeNext module resolution. Don't drop them.
- **Path safety:** any code that resolves user-supplied paths under `agentDir` must go through `assertInside` in [src/util/paths.ts](agent/src/util/paths.ts) — it's `realpath`-based, tolerates non-existent targets, and blocks symlink escape. The skills installer/remover are the canonical examples; treat any new path-handling code the same way.
- **Logging:** use `log` from [src/util/logger.ts](agent/src/util/logger.ts). It's a `pino` instance with redaction rules for `token`, `apiKey`, `botToken`, and auth headers — extend `redact.paths` when adding new sensitive fields rather than logging selectively.
- **Validation at the edge:** every external input (config files, `mcp.json`, HTTP `PATCH /config` bodies) is parsed through a Zod schema in [src/config/schema.ts](agent/src/config/schema.ts). Internal code trusts `AgentConfig` as the parsed type.
- **No package-manager mixing:** `agent/` is pnpm (`pnpm-lock.yaml`), `app/` is npm (`package-lock.json`). Use the right one for the tree you're in; don't mix.

## Tests

Vitest, Node environment, 10s timeout. Tests live in [agent/test/](agent/test/) and use [agent/test/fixtures/test-agent/](agent/test/fixtures/test-agent/) for any test that needs an agent directory. `runtime.test.ts` exercises the full message loop against `MockLanguageModelV1` from `ai/test` — copy that pattern when adding runtime tests; don't mock at the `generateText` level.

Temp store files (`test/.tmp-*.db`, `test/.tmp-*.json`) are gitignored — clean them up with `fs.unlinkSync` in the test before opening the store (see `runtime.test.ts`).
