# 0G Study — submission

**Prize:** ETHGlobal Mumbai — 0G "Build with 0G Private Computer"

## Short description

Photograph your notes. A pod of three AI agents — a Note Reader, a Tutor and an Examiner — turns them into a clear explanation, six flashcards and a quiz, in one channel where every hand-off is visible. A daily study streak brings you back tomorrow. Every reply runs on 0G Private Computer and shows the 0G request ID that produced it.

**What breaks without 0G:** Remove 0G and the pod stops: the Note Reader can't read the photo, and the Tutor and Examiner have no inference.

## Links

| | |
|---|---|
| Repository | _add public GitHub URL_ |
| Live demo | _add deployed app URL_ |
| Demo video (< 3 min) | _add video URL_ |
| Contract | `BonFireAgentINFT` — [`0x151819ebc4435937f704FbB726DE6f99Bda262Bb`](https://chainscan-galileo.0g.ai/address/0x151819ebc4435937f704FbB726DE6f99Bda262Bb), 0G Galileo testnet, chainID 16602 |
| Request IDs | From the live end-to-end verification run on 2026-11-06 (`agent/scripts/e2e-pod.mjs`, 0G Private Computer): Note Reader `38be190d-5745-4d71-b183-84c46d7cf4a2`, Tutor `a6df8c89-771e-44ec-a6f5-51d7f5eb4ad6`, Examiner `e12b1b2b-8625-4376-bc68-e55245ba8c26`. _Add IDs from the recorded demo too._ |

## Team

| Name | Telegram | X |
|---|---|---|
| _name_ | _@handle_ | _@handle_ |

## How it meets the prize requirements

| Requirement | How |
|---|---|
| Inference on 0G Private Computer in the main flow, with request IDs | All three pod agents use the `zerog-router` provider (`https://router-api.0g.ai/v1`). The photo is read by a 0G vision model (`qwen2.5-vl-72b-instruct`) through the `read_notes` tool; explanations, flashcards and grading use `deepseek-v4.1-flash`. Every call is traced; the request IDs of each turn are shown as a copyable badge on the reply. |
| A working app with a reason to come back tomorrow | A per-user daily study streak and a growing flashcard count in the status bar. The Examiner keeps quizzing you; the composer is pre-filled so the quiz loop needs no typing beyond the answer. |
| One sentence on what breaks without 0G | See above; it is also on the home page and in the README. |
| Bonus: 0G account with a decreasing credit balance | **Implemented as "connect your 0G account"** (feature flag). The Router has no OAuth flow, so the user pastes their own `sk-` API key and a read-only `mk-` management key from pc.0g.ai. Their pod calls are billed to their own deposit, and the status bar shows `Credits: X 0G` from `GET /v1/account/balance`, re-read after each reply, so it goes down as they study. Keys are stored encrypted server-side and never returned to the browser. It is not a one-click "Sign in with 0G" button, because 0G does not offer one to third-party apps. |

## How it works

1. The user attaches a photo in `#study`. The browser downscales it (≤ 1280 px JPEG) and uploads it to the agent runtime, authenticated with a short-lived study token from the backend. The message carries an `[[upload:<id>]]` marker.
2. `@study-note-reader` calls `read_notes(uploadId)` → a vision completion on 0G Private Computer → faithful markdown + key concepts. It ends with `@study-tutor`.
3. The backend's @mention cascade invokes the Tutor with the Reader's reply. A pipeline hand-off rule (`PIPELINE_HANDOFFS`) tells pipeline stages to hand off even though agents are otherwise told not to forward.
4. `@study-tutor` explains, writes 6 flashcards and calls `study_log` — stored per user, per UTC day — then hands off to `@study-examiner`, which asks one question and never mentions anyone, ending the cascade.
5. The router returns request IDs in `X-Request-Id`; the runtime collects the IDs of each turn (kept per request with `AsyncLocalStorage`, so concurrent users never mix) and appends them to the reply, which the UI renders as a badge.

## Safety and honesty

- The 0G key never reaches the browser. Study endpoints require a backend-signed token; a user can only read their own streak. Per-user daily caps on 0G calls (30) and photo uploads (20). Photos are deleted after 24 hours.
- If 0G fails, the agent says so in one line; the Note Reader never invents notes it could not read.
- The request ID proves which 0G Private Computer calls produced a reply and can be matched in the pc.0g.ai dashboard. The app does not verify TEE attestations itself, and we make no hardware claims beyond 0G's own description of Private Computer.

## Built on (existing work)

0G Study is built on BonFire, our earlier 0G project: a Discord-style workspace with servers, channels, @mention cascades, an agent marketplace, INFT agents (`BonFireAgentINFT`, encrypted bundles on 0G Storage, ECIES-sealed keys, public/permissioned usage; transfers disabled in v1), server wallets with on-chain checks for paid agent invites, a knowledge base, an audit log, and Daily.co voice channels.

**Planned, not built:** escrow and royalty-splitter contracts, fine-tuning from reactions, and storing study data on 0G Storage.

## What's next

Spaced repetition over logged flashcards, more subjects and pod roles, and a one-click 0G sign-in if 0G opens an OAuth flow to third-party apps.
