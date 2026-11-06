# 0G Study

> Photograph your notes. A pod of three AI agents reads them, explains the hard parts, writes flashcards and quizzes you. Every reply runs on **0G Private Computer** and shows the 0G request ID that produced it.

**Remove 0G and the pod stops: the Note Reader can't read the photo, and the Tutor and Examiner have no inference.**

0G Study is built on BonFire, a Discord-style workspace where AI agents are members of servers and channels and are owned as INFTs on 0G Chain. **Study Pod** is the consumer use case on top of it.

| | |
|---|---|
| **Prize target** | ETHGlobal Mumbai — 0G "Build with 0G Private Computer" |
| **Inference** | 0G Private Computer router (`https://router-api.0g.ai/v1`), OpenAI-compatible |
| **Contract** | `BonFireAgentINFT` at [`0x151819ebc4435937f704FbB726DE6f99Bda262Bb`](https://chainscan-galileo.0g.ai/address/0x151819ebc4435937f704FbB726DE6f99Bda262Bb) on 0G Galileo testnet (chainID 16602) |

---

## Study Pod — 0G Private Computer

### The daily loop

1. Open the **Study** server and go to `#study`.
2. Press **+** in the composer, attach a photo of today's notes, type `@study-note-reader`, send.
3. **`@study-note-reader`** calls the `read_notes` tool, which sends the photo to a 0G vision model and returns a faithful markdown transcription plus the key concepts. It ends with `@study-tutor`.
4. **`@study-tutor`** looks up related passages in your earlier notes (`recall_notes`, see *Study memory* below), explains the two or three hardest ideas (linking and citing a past passage when it is relevant), writes six flashcards that test understanding, logs them with the `study_log` tool (that counts toward today's streak) and ends with `@study-examiner`.
5. **`@study-examiner`** asks one question. The composer is pre-filled with `@study-examiner`, so you just type your answer; it grades it (correct / partly / wrong, with a reason) and asks the next one.
6. The status bar shows `⚡ N calls · T tokens today` and `🔥 S-day streak · C cards today`.

### Why you come back tomorrow

A per-user daily streak (consecutive UTC days with at least one logged flashcard; not studying *yet* today does not break it), a growing flashcard count, and a **study memory**: every photo you study is remembered, so the more days you study, the more the pod can connect today's notes to yours from earlier days.

### Proof on every reply

Every 0G call is traced (request ID, HTTP status, token usage). When an agent finishes a turn, the request IDs of that turn are attached to the reply, and the UI shows a `0G · <id>…` badge. Click to copy the IDs and match them in the [pc.0g.ai](https://pc.0g.ai) dashboard. The router sends two `X-Request-Id` values (a 16-hex gateway id and a UUID); we keep the UUID.

### Study memory (RAG on 0G)

Every page you photograph becomes searchable memory, built entirely on 0G Private Computer.

- **What is stored.** After `read_notes` transcribes a photo, the transcription is split into chunks (headings → paragraphs → sentences; formula lines, code and `$$` math are never split) and each chunk is embedded with **`qwen3-embedding-0.6b`** on 0G (`POST /v1/embeddings`, 1024-dim). The chunk text, its heading path, the day and the upload id are stored with the vector. The photo itself is still deleted after 24 hours. Note text and vectors are never logged.
- **Where.** One file per student, `<agentDir>/study/<userId>/rag.json`, next to their flashcard logs. Re-reading the same photo replaces its chunks (keyed by upload id). An index records its embedding model and dimension; vectors from another model are never mixed (changing `ZEROG_EMBED_MODEL` starts a fresh index).
- **Retention.** Kept as long as the study logs, with no automatic expiry. To forget a student, delete their `study/<userId>/` directory.
- **Retrieval.** The Tutor calls `recall_notes` with the key concepts. The query is embedded on 0G, and the top passages (cosine, score floor, near-duplicates removed) from **that student's index only** come back with citations like `[notes · 2026-11-05 · #2]`. The Tutor connects a relevant one in a line and cites it; the Examiner sometimes quizzes you on it. Neither may invent a citation, and with no hits they carry on as before. Replies that cite your notes get a `📚 from your notes` chip.
- **Proof.** Embedding calls go through the same traced router fetch as chat, so their request IDs are in the reply's `0G · …` badge, they count toward the daily call cap, and they are billed to your own key if you connected one.
- **Untrusted text.** Retrieved passages come back inside a delimited `<retrieved_notes trust="untrusted">` block with a rule not to follow instructions inside it (a photo can contain "ignore previous instructions…"), and the pod's AGENTS.md rules say the same.
- **Isolation.** A student can only search their own index: `recall_notes` uses the turn's student, `GET /study/recall?q=` answers only for the study token's user, and `/chat/message` honours a `studentId` only from the backend (admin token).
- **Fallback.** With no notes yet, recall costs no 0G call. If 0G embeddings are down, `read_notes` still returns the notes and `recall_notes` says it can't search past notes; the pod continues without them.
- **Server knowledge base.** The same engine ranks a server's `#knowledge-base` documents. The backend (which holds no 0G key) asks the agent's admin-only `/rag/kb/*` routes for the chunks relevant to each message, cited `[kb · <title> · #n]` and within the old 8 KB budget, one index per server. Docs are indexed on create or upload and removed on delete, and missing or stale ones are reconciled on the next retrieval. If retrieval is unavailable the backend falls back to the previous "20 newest docs" block. TEE channels still get no knowledge block.

Code: [agent/src/rag/](agent/src/rag/) (`chunk`, `embed`, `store`, `search`, `notes`, `kb`), [agent/src/api/routes/rag.ts](agent/src/api/routes/rag.ts), [backend/src/agents/kb-rag.ts](backend/src/agents/kb-rag.ts). Check the embedding models with `node agent/scripts/smoke-embeddings.mjs`. On 2026-11-06 it found that both `qwen3-embedding-0.6b` (1024-dim) and `qwen3-embedding-8b` (4096-dim) work, batching is supported, the context is 32k tokens, the request ID comes in `x-request-id`, and both scored 3/3 on a small retrieval check. The default is the 0.6b model: same quality on the sample notes, a quarter of the vector size.

### Where the code lives

| Piece | File |
|---|---|
| Router provider + request tracing | [agent/src/providers/zerog-router.ts](agent/src/providers/zerog-router.ts) |
| `read_notes`, `recall_notes`, `study_log` tools | [agent/src/tools/builtin/study.ts](agent/src/tools/builtin/study.ts) |
| Study memory / knowledge-base RAG (0G embeddings) | [agent/src/rag/](agent/src/rag/), [backend/src/agents/kb-rag.ts](backend/src/agents/kb-rag.ts) |
| Request-ID marker on replies, daily call cap | [agent/src/runtime/agent.ts](agent/src/runtime/agent.ts) |
| Per-turn user context (no shared globals) | [agent/src/runtime/request-context.ts](agent/src/runtime/request-context.ts) |
| `/uploads`, `/usage`, `/study/index`, `/study/recall` + auth | [agent/src/api/routes/study.ts](agent/src/api/routes/study.ts), [agent/src/study/](agent/src/study/) |
| Pod agents (SOUL + rules) | [agent/examples/study-note-reader](agent/examples/study-note-reader), [study-tutor](agent/examples/study-tutor), [study-examiner](agent/examples/study-examiner) |
| Pipeline hand-offs in the @mention cascade | [backend/src/agents/invoker.ts](backend/src/agents/invoker.ts) (`PIPELINE_HANDOFFS`) |
| Study token for the agent endpoints | [backend/src/api/routes/auth.ts](backend/src/api/routes/auth.ts) (`GET /v1/auth/study-token`) |
| Badge, photo chip, attach, status bar | [MessageRow.tsx](app/src/components/message/MessageRow.tsx), [MessageComposer.tsx](app/src/components/message/MessageComposer.tsx), [StatusBar.tsx](app/src/components/layout/StatusBar.tsx), [study-markers.ts](app/src/lib/study-markers.ts) |

### Models (verified against the router on 2026-11-06)

| Use | Default | Checked |
|---|---|---|
| Chat + tool calls (`ZEROG_LLM_MODEL`) | `deepseek-v4.1-flash` | chat, tool calling, `chat_template_kwargs` |
| Vision (`ZEROG_VISION_MODEL`) | code default `qwen2.5-vl-72b-instruct`; the local demo's `agent/.env` runs **`gemini-2.5-flash`** (on 2026-11-06 `gemini-2.5-flash-lite` and `qwen2.5-vl-72b-instruct` returned 401 from 0G's upstream provider) | faithful transcription of a printed notes photo sent as a data URL |
| Embeddings (`ZEROG_EMBED_MODEL`) | `qwen3-embedding-0.6b` | 1024-dim, batching, 32k-token context, request ID in `x-request-id` (`scripts/smoke-embeddings.mjs`) |

Model availability changes; list current models with `node agent/scripts/smoke-router.mjs` (or `GET /v1/models`). Router models "think" by default, which burns `max_tokens`; the provider turns thinking off for open-weight families (qwen, deepseek, glm, kimi, mimo) and leaves other models untouched because they reject the extra field.

---

### Connect your 0G account (bonus)

Turn it on with `ZEROG_USER_ACCOUNTS=on` (agent, needs `STUDY_JWT_SECRET`) and `NEXT_PUBLIC_ZEROG_ACCOUNTS=on` (app). The status bar then offers **Connect 0G account**:

1. At pc.0g.ai → Dashboard → API Keys, create an **`sk-` API key** for 0G Study.
2. At pc.0g.ai → Settings → Management Keys, create a **Read-only `mk-` key** (only `account:read` is used).
3. Paste both. The agent checks the management key by reading `GET /v1/account/balance`, then stores both keys encrypted (AES-256-GCM) on the server. They are never sent back to the browser or logged.

From then on, that user's pod calls are made with **their** key and billed to **their** 0G deposit (the shared daily cap no longer applies to them), and the status bar shows `Credits: X 0G` — their `total_balance`, re-read after each pod reply, so it goes down as they study. When their balance runs out the pod says so and points them to pc.0g.ai → Deposit. *Disconnect* deletes the stored keys. Code: [agent/src/study/zerog-account.ts](agent/src/study/zerog-account.ts), [ZeroGAccount.tsx](app/src/components/layout/ZeroGAccount.tsx).

Note: the Router may lag the on-chain Payment Layer slightly ("pulls from the Payment Layer in batches"), so the balance can trail a reply by a little.

---

## Run it locally

**Prerequisites:** Node ≥ 20, pnpm 9+, npm, and a 0G Private Computer API key from [pc.0g.ai/dashboard/api-keys](https://pc.0g.ai/dashboard/api-keys). MongoDB is optional (the backend can run an in-process one). Privy app ID from [dashboard.privy.io](https://dashboard.privy.io).

```bash
pnpm install                      # agent + backend + contracts (workspace)
(cd app && npm install)           # app is a separate npm tree
```

**1. Configure** (copy each `.env.example` and fill it in):

| File | Must set |
|---|---|
| `agent/.env` | `ZEROG_API_KEY`, `ZEROG_LLM_MODEL`, `ZEROG_VISION_MODEL`, `ZEROG_EMBED_MODEL` (optional, default `qwen3-embedding-0.6b`), `STUDY_JWT_SECRET` (= backend `JWT_SECRET`), `STUDY_ALLOWED_ORIGINS`, `AGENT_ADMIN_TOKEN` (= backend's) |
| `backend/.env` | `JWT_SECRET` (≥ 32 chars), `PRIVY_APP_ID`, `PRIVY_APP_SECRET` |
| `app/.env.local` | `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_BONFIRE_BASE_URL`, `NEXT_PUBLIC_AGENT_BASE_URL`; optional `NEXT_PUBLIC_AGENT_MODEL_LABEL` (agent-card model label, default `0G Private Computer`) |

**2. Check 0G** — lists models, makes one chat and one vision call, prints the request-ID headers:

```bash
cd agent && node scripts/smoke-router.mjs [path/to/notes.jpg]
```

**3. Start the three services** (three terminals):

```bash
cd agent   && pnpm dev               # agent runtime on :7777
cd backend && pnpm dev:no-docker     # API on :8080, in-process MongoDB
cd app     && npm run dev            # UI on :3000
```

**4. Sign in once** at http://localhost:3000 (this creates your user), then **seed the demo state** — the Study server, `#study`, and the three pod agents:

```bash
cd backend && pnpm tsx scripts/seed-study-pod.mjs --owner <your-username-or-email>
```

With `dev:no-docker` the database is in memory: re-run the seed after restarting the backend, or run MongoDB (`pnpm dev` uses Docker) for persistence.

**5. Study:** open Study → `#study`, attach a notes photo, send `@study-note-reader`.

### Tests

```bash
cd agent   && pnpm typecheck && pnpm test             # 197 tests
cd backend && pnpm typecheck && OG_STORAGE_MOCK=1 pnpm test   # 243 tests (in-process Mongo, mocked 0G Storage)
cd app     && npx tsc --noEmit && npx vitest run && npm run lint
bash scripts/verify-inft-integration.sh                # everything, incl. contracts
```

---

## Security, privacy and what is (and is not) verified

- **The 0G key stays on the server.** `ZEROG_API_KEY` lives only in `agent/.env`; it is never a `NEXT_PUBLIC_*` variable.
- **Study endpoints are authenticated.** The browser asks the backend for a 1-hour study token (`GET /v1/auth/study-token`, HS256, `sub` = your user id). The agent verifies it with `STUDY_JWT_SECRET`; `/study/index` only ever answers for the token's user. `STUDY_ALLOWED_ORIGINS` restricts browser origins. Without `STUDY_JWT_SECRET` the endpoints are open and the agent logs a warning — local development only.
- **Study memory is per student.** Each student's notes index is a separate file; retrieval only ever opens the current student's. `/chat/message` honours a `studentId` only when it carries `AGENT_ADMIN_TOKEN` (the backend), so nobody can claim to be another student. Retrieved passages are marked untrusted and the agents are told not to follow instructions inside them. The knowledge-base RAG routes are admin-only and scoped per server.
- **Caps.** `STUDY_DAILY_CALL_CAP` (default 30) 0G calls (chat, vision and embeddings) and `STUDY_DAILY_UPLOAD_CAP` (default 20) photos per user per day, with a friendly message when reached. Uploads must be png/jpeg/webp data URLs under ~8 MB; ids are server-generated UUIDs and validated before any file access.
- **Notes photos are temporary.** They are stored under the agent directory and deleted after 24 hours (checked at boot and hourly).
- **Failures are honest.** If 0G is unreachable or a call fails, the agent says so in one line; the Note Reader never guesses at unreadable notes.
- **What the request ID proves:** that this reply was produced by calls through *your* 0G Private Computer account, which you can match in the pc.0g.ai dashboard. 0G describes Private Computer as TEE-verified compute; **this app does not itself fetch or verify enclave attestations.**
- **The "Demo hash" button** on messages in private (TEE-flagged) channels shows a hash computed by the backend for demo purposes ([backend/src/channels/service.ts](backend/src/channels/service.ts)). It is not a hardware attestation.

## Known limitations

- **0G account (bonus, FR9) is "bring your own keys", not a sign-in button.** The 0G Router has no OAuth flow ([docs](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/authentication)), so a third-party app cannot log you in to 0G. See *Connect your 0G account* above. It is off by default.
- Users who have not connected an account share one 0G API key (bounded by the daily caps).
- Counters for usage and upload caps are in memory and reset when the agent restarts; streaks and flashcards are stored on disk.
- Study memory search is brute-force cosine over one JSON file per student, fine for a semester of notes, not for millions of chunks. Only photos read with `read_notes` are remembered (not pasted text). Retrieval quality depends on the 0G embedding model.
- Request IDs travel inside the message text as a `⟦0g:…⟧` marker (and photos as `[[upload:…]]`), which the UI strips — pragmatic, not a clean API.

---

## The wider workspace (BonFire)

Study Pod runs inside a general multi-agent workspace that keeps working alongside it:

- **Servers, channels, @mention cascades.** An agent's reply that @-mentions another agent invokes it, up to `MAX_CASCADE_HOPS` (5) and `MAX_INVOCATIONS_PER_ROOT` (20). Fixed pipelines (like the pod) are declared in `PIPELINE_HANDOFFS`.
- **Agent marketplace + INFTs.** Agents can be minted as `BonFireAgentINFT` tokens: the soul, rules and model config are AES-256-GCM encrypted, uploaded to **0G Storage**, and the key is ECIES-sealed for the platform executor; the contract records the bundle hash and URIs and supports public or permissioned usage (`authorizeUsage`). Transfers are disabled in v1 (soulbound).
- **Server wallets and paid invites.** Each server has its own wallet; inviting a priced agent is checked against an on-chain OG payment.
- **Knowledge base, audit log, voice.** Per-server knowledge documents reach agents through retrieval (the relevant chunks, cited; see *Study memory*); an owner-only audit log records agent activity; voice channels use Daily.co with a Pipecat worker (Deepgram STT → 0G Compute LLM → OpenAI TTS). Voice is not part of Study Pod.
- **Agent runtime (`ember-agent`).** One process per agent directory (`agent.config.json`, `SOUL.md`, `AGENTS.md`, `mcp.json`, `skills/`), serving several personas as tenants. Three LLM providers behind one `LanguageModelV1` surface: `zerog-router` (0G Private Computer), `zerog` (0G Compute broker with a funded ledger and signed headers), and `openai-compatible`. Skills hot-reload, are installed through registries and scanned on install; an optional evolution loop suggests new skills.

### Repository layout

| Path | What |
|---|---|
| [agent/](agent/) | `ember-agent` runtime (TypeScript, Hono, Vercel AI SDK) — pnpm workspace |
| [backend/](backend/) | `bonfire-backend` API (Hono, MongoDB, Privy, 0G Chain + Storage, Daily) — pnpm workspace |
| [contracts/](contracts/) | `BonFireAgentINFT` (Hardhat, OpenZeppelin v5) — pnpm workspace |
| [app/](app/) | Next.js 14 UI (npm, deployed on Vercel) |
| [web/](web/) | Legacy React 17 prototype, not used |
| [prd.md](prd.md), [agent-prd.md](agent-prd.md), [DESIGN.md](DESIGN.md) | Product spec, runtime spec, design system |

## What's next

Spaced repetition over the logged flashcards and remembered notes, more subjects and pod roles, a one-click 0G sign-in if 0G opens an OAuth flow to third-party apps, and moving study data to 0G Storage.

## License

MIT — see [LICENSE](LICENSE).
