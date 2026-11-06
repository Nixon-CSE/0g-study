# PR: Study memory — RAG on 0G Private Computer

PR description for the work in `docs/prompts/rag-implementation.md` (commits `2052c54` → HEAD). Paste it into the GitHub PR when this branch is pushed.

## Phase 0 findings (0G embeddings)

These results come from `node agent/scripts/smoke-embeddings.mjs`, run against `https://router-api.0g.ai/v1/embeddings` with the shared `ZEROG_API_KEY` on 2026-11-06.

| | `qwen3-embedding-0.6b` | `qwen3-embedding-8b` |
|---|---|---|
| `POST /v1/embeddings` | HTTP 200 | HTTP 200 |
| Vector dimension | **1024** | 4096 |
| Batching (`input: string[]`) | works (3 inputs → 3 vectors in one call) | works |
| Max input | 32,768 tokens (an input of about 34.7k tokens returns HTTP 400 "longer than the model's context length") | same |
| Latency (single / batch of 3) | about 2–5 s / about 3 s | about 2 s / about 3.4 s |
| Request ID | `x-request-id` header with two values, `<16-hex gateway id>, <UUID>`, the same shape as chat. `pickRequestId` keeps the UUID. The body has no `id`. | same |
| `usage` | `prompt_tokens` / `total_tokens` present | same |
| `chat_template_kwargs` | accepted and ignored. `withThinkingOff` only rewrites `/chat/completions`, so it is never sent to embeddings anyway. | same |
| Quality check (3 study-note passages, 3 questions) | 3/3 correct top-1, with clear margins (≈0.62–0.75 vs ≈0.15–0.27) | 3/3 |

**Decision:** the default is `ZEROG_EMBED_MODEL=qwen3-embedding-0.6b`. Its quality on the sample notes matched the 8B model at a quarter of the vector size: 4 KB per chunk instead of 16 KB in the per-student index. An index records its model and dimension and never mixes vectors. Changing the model starts a fresh index.

## What changed

- **Phase 1, student study memory:** `agent/src/rag/` (`chunk`, `embed`, `store`, `search`, `notes`).
  - `read_notes` indexes each transcription per student. A failure never fails the read.
  - `recall_notes` returns `[notes · <day> · #n]` citations.
  - Read-only `GET /study/recall`.
  - Tutor and Examiner rules are in AGENTS.md, and `agent/data/tenants.json` is synced.
  - A "📚 from your notes" chip in the app.
- **Phase 2, knowledge base:** admin-only `/rag/kb/{index,delete,search}` in the agent, with `/rag` added to `ADMIN_PREFIXES` and one index per `serverId`.
  - The backend `buildKnowledgeBlock` uses retrieval via `agentFetch`.
  - Docs are indexed on create and upload and deleted on delete; retrieval reconciles any missing or stale ones.
  - It falls back to the newest 20 docs, and TEE channels are unchanged.
- **Security gap closed:** `/chat/message` accepted any `studentId`, so a caller could act as another student and read their notes. It now honours one only with `AGENT_ADMIN_TOKEN` (deployments) or from a same-origin caller (local dev). The backend sends it via `agentFetch`.
- **Untrusted text:** retrieved passages come back inside `<retrieved_notes|knowledge_base trust="untrusted">` with a do-not-follow rule. The block can't be closed early.

## Definition of done: how each item is verified

| # | Item | Evidence |
|---|---|---|
| 1 | Day-2 Tutor references day 1 with a citation; Examiner asks from day 1 | Integration (`agent/test/rag-integration.test.ts`): day 1 and day 2 set with a fake clock, recall returns `[notes · 2026-11-05 · #n]`, and the runtime turn's reply cites it. Live (`scripts/e2e-live.mjs` §7, real 0G): two photos, the Tutor answers from the first one with a citation, and the Examiner asks a question about the first photo. The live run happens on one calendar day, because the server clock sets the day; the cross-day case is only covered by the integration test. |
| 2 | Embeddings through 0G, traced, ID in the badge | `rag-embed.test.ts` (kind `embedding`, request ID, cap, own key). Live: the read reply carries the vision and embedding IDs, and `/study/recall` returns a UUID. |
| 3 | No cross-student retrieval | Tool, `/study/recall` (401/403/empty) and forged `studentId` on `/chat/message` in `rag-integration.test.ts`. Live check too. |
| 4 | Graceful when there is no data or embeddings are down | `rag-integration.test.ts` (no 0G call with no data; `read_notes` still ok; one honest line). |
| 5 | `./run-tests.sh` passes | See below. |

## Test summary (`./run-tests.sh`, 2026-11-06)

```
PASS  agent typecheck
PASS  agent tests      Tests 197 passed (197)
PASS  backend typecheck
PASS  backend tests    Tests 243 passed | 5 skipped (248)
PASS  app typecheck
PASS  app tests        Tests 18 passed (18)
PASS  app lint
PASS  contracts tests  18 passing
PASS  live e2e         33 passed, 0 failed, 2 skipped (the full backend pipeline needs E2E_PRIVY_TOKEN)
```

## Deploy notes

- Set `AGENT_ADMIN_TOKEN` (the same value) on both agent and backend, plus `EMBER_AGENT_BASE_URL` on the backend. `ZEROG_EMBED_MODEL` is optional.
- **Restart the backend** after pulling, so `/chat/message` carries the admin token. Without it the agent drops `studentId`, and streaks and memory stop working.
