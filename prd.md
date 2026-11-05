# PRD: 0G Study on 0G Private Computer

Target: ETHGlobal Mumbai, 0G prize **"Build with 0G Private Computer" ($5,000)**
Repo: the existing BonFire repo (`agent/`, `backend/`, `app/`, `contracts/`, `web/`)
Audience: Claude Code, executing in that repo. Read this whole file first, then work through section 10 in order.

**Starting point:** the repo exactly as it is today. Nothing in this PRD has been implemented yet. Everything below is a specification to build. Where something is unknown, it is marked **UNVERIFIED** and has a step to resolve it. Do not guess values marked UNVERIFIED; confirm them against the real 0G API or ask the user.

---

## 1. Summary

0G Study is a Discord-style multi-agent workspace (servers, channels, @mention cascades, INFT agents, marketplace). **Study Pod** is a consumer use case on top of it: a student photographs their notes, and a pod of three agents works on them in one channel:

`@study-note-reader` (0G vision transcribes the photo) → `@study-tutor` (explains the hard ideas, writes flashcards, logs them) → `@study-examiner` (quizzes the student and grades answers).

A daily **study streak** is the reason to return tomorrow. **All inference runs on 0G Private Computer** (OpenAI-compatible router, TEE-verified), and **every agent reply shows its 0G request ID**.

The product has to change in two places: the **working app** (provider, tools, UI) and the **public-facing content** (home page, pitch page, page metadata, README, submission text), which currently describe a generic "agent guild" product and contain outdated claims.

## 2. Prize requirements (source: the ETHGlobal 0G page)

Prize text: *Build a consumer app where AI on 0G is the product: something people open, use, and come back to tomorrow.*

Must show:
- [ ] Inference on 0G Private Computer in the main user flow, **with request IDs**
- [ ] A working app a judge can try, with a clear reason someone comes back tomorrow
- [ ] One sentence on what breaks if 0G is removed
- [ ] (Bonus) A user signs in with their **0G account** and their **credit balance goes down** as they use the app

Not wanted: generic chat wrappers; apps where the AI call could be removed without anyone noticing.

Submission: project name and short description; public GitHub repo with README and setup; demo video under 3 minutes and a live demo link; contract deployment addresses (existing: `BonFireAgentINFT` on 0G Galileo testnet `0x151819ebc4435937f704FbB726DE6f99Bda262Bb`, chainID 16602); team names with Telegram and X.

Models named on the page: image `seedream`, `hy-image`, `z-image`; video `seedance`, `minimax-h3`; speech `whisper-large-v3`; multimodal `qwen omni`, `qwen vision`; native `0gm-1.0`.

**The "what breaks without 0G" sentence (use verbatim in README, home page, submission):** "Remove 0G and the pod stops: the Note Reader can't read the photo, and the Tutor and Examiner have no inference."

## 3. Goals and non-goals

Goals
1. A judge can attach a photo of notes and watch three agents respond in sequence, each reply with a clickable 0G request ID.
2. A visible reason to come back: a per-user daily streak and accumulating flashcards.
3. Live 0G usage shown in the UI.
4. Home page, pitch page, metadata, README and submission all describe Study Pod accurately.
5. (Bonus) 0G account sign-in with a decreasing credit balance, only if the mechanism can be confirmed (FR9).

Non-goals
- Removing or breaking the existing 0G broker provider (`provider: "zerog"`), INFT mint/transfer, marketplace, voice, or escrow features. They stay working.
- Voice, fine-tuning, new contracts, mobile layout.
- Rewriting the old `web/` app.

## 4. Users and daily loop

User: a student or self-learner with notes on paper or a whiteboard.

1. Open 0G Study, go to the `#study` channel of the study server.
2. Press **+** in the composer, attach a photo of today's notes, type `@study-note-reader`, send.
3. Reader transcribes and hands off to Tutor. Tutor explains the hardest ideas, writes 6 flashcards, logs them (streak counts for the day). Tutor hands off to Examiner, who asks one question.
4. The student answers by mentioning `@study-examiner`; Examiner grades and asks the next question.
5. The status bar shows the streak, cards today, and 0G usage today.

## 5. Current repo state (relevant facts, verify before editing)

- `agent/src/runtime/llm-client.ts` supports `provider: "openai-compatible"` and `provider: "zerog"`. The latter uses `@0glabs/0g-serving-broker`, a funded ledger, and per-request signed headers. It does **not** expose request IDs.
- `agent/src/config/schema.ts` (`LlmConfigSchema`) restricts `provider` to those two values. The same two-value enum is repeated in `agent/src/api/routes/chat.ts` (tenant schema), `agent/src/tenants/types.ts`, `agent/src/channels/base.ts`, and `backend/src/agents/client.ts`.
- `agent/src/runtime/agent.ts` builds the reply with `generateText` (up to 8 steps) and sends it with `msg.reply(final)`. Replies reach the backend through the stream; the backend stores them via `insertMessage` in `backend/src/agents/invoker.ts` (streaming and non-streaming paths, plus the cascade path that follows @mentions).
- Tools are registered in `agent/src/tools/registry.ts` from `BuiltinToolsSchema` in `agent/src/config/schema.ts`. Built-in tools live in `agent/src/tools/builtin/`.
- `agent/src/api/server.ts` composes the Hono routes. CORS is currently open to any origin.
- `agent/src/index.ts` builds the tool registry with `buildToolRegistry(loaded.config, mcpHandles)`; the agent directory is `loaded.dir`.
- `agent/examples/default-agent` is the example agent; its `agent.config.json` uses `provider: "zerog"`.
- App: `app/src/components/message/MessageRow.tsx` renders message text as plain text and a "TEE Verified" button when `msg.teeHash` exists. `MessageComposer.tsx` has a **+** button that does nothing and a plain text input. `app/src/components/layout/StatusBar.tsx` shows the wallet address and OG balance, polling the 0G Galileo RPC. `app/src/lib/config.ts` exports `AGENT_BASE_URL` and `BONFIRE_BASE_URL`. `PrivyClientProvider.tsx` reads `NEXT_PUBLIC_PRIVY_APP_ID`.
- Public-facing pages with outdated or generic content: `app/src/app/page.tsx` (home), `app/src/app/pitch/page.tsx` (slides), `app/src/app/layout.tsx` (site title/description), `README.md`, `submission.md`. Stale claims to remove: "Live on 0G Mainnet — Aristotle", "LIVE · 0G CHAIN 16661", "Real 0G mainnet txs", "0G Mainnet (Sept 2025) / Live since Aristotle launch", and Intel TDX / NVIDIA H100/H200 hardware claims. The deployed INFT contract is on **Galileo testnet (16602)**, not mainnet.

Before changing anything: install dependencies, then confirm the agent test suite, and type-checks for `agent`, `backend` and `app`, pass. Record the baseline (note any pre-existing failures so they are not attributed to this work).

## 6. Known gaps and risks

| # | Gap | Handling |
|---|-----|----------|
| G1 | Exact router model IDs for chat and vision are **UNVERIFIED** | Resolved in step 1 by listing models from the router; put the real IDs in `.env.example` |
| G2 | Name of the response header carrying the request ID is **UNVERIFIED** | Resolved in step 1; fall back to the `id` field of the JSON body |
| G3 | Streak/cards must be **per user**, not global | FR4 |
| G4 | No 0G account sign-in or credit balance | FR9 (bonus), blocked on an answer from 0G |
| G5 | Upload and usage endpoints would be unauthenticated with open CORS | NFR1 |
| G6 | Markers inside message text are a pragmatic transport, not a clean API | Accepted for the hackathon; document it |
| G7 | Examiner ends the cascade, so the student's answer must re-mention it | FR6 |
| G8 | 0G's Privy app ID only works on `localhost:3000`, `3001`, `5173` (per the prize page) | Hosted demo uses the team's own Privy app; bonus flow shown on localhost in the video |
| G9 | Vision input format (data URL in `image_url`) is **UNVERIFIED** for the chosen model | Resolved in step 1 with a real vision call |

## 7. Functional requirements

### FR1: 0G Private Computer provider (agent)
- Add a new provider value `zerog-router` alongside the existing two. It talks to the router API at `https://router-api.0g.ai/v1` using an OpenAI-compatible client and the key from env `ZEROG_API_KEY` (created at pc.0g.ai/dashboard/api-keys). Base URL overridable by `ZEROG_BASE_URL`.
- Add the new value to **every** place the provider enum is repeated (see section 5): agent config schema, tenant payload schema in the chat route, tenant types, channel base types, backend agent client type. Also allow the backend's agent-registration schema to accept it if it validates providers.
- Config resolution: when `provider` is `zerog-router`, the key env name defaults to `ZEROG_API_KEY` and the model defaults to env `ZEROG_LLM_MODEL`.
- Wrap the HTTP layer so every call (chat and vision) is traced: request ID (header, per G2), HTTP status, `usage.total_tokens` when the body is JSON, timestamp. Keep an in-memory list of calls since the last drain and a list of today's calls for usage.
- Acceptance: with a real key, a message to a `zerog-router` agent returns a normal reply, and the call list contains one entry with a non-empty request ID.

### FR2: Request IDs on every reply
- After the agent produces its final reply, drain the traced calls for that turn and append a single marker line at the end of the reply text containing the comma-separated request IDs, using a delimiter pair that cannot appear in normal text (the design uses `⟦0g:` … `⟧`).
- Only append the marker when at least one request ID exists.
- UI (`MessageRow.tsx`): parse the marker out of the text, strip it from the displayed message, and show a badge in the message header: `0G · <first 8 chars>…` plus `+N` when there are more. Clicking copies all IDs to the clipboard. The badge has a tooltip listing the IDs. Extract the parsing into a pure helper so it can be unit-tested.
- The existing "TEE Verified" attestation button keeps working for messages that have `teeHash`.
- Acceptance: three consecutive agent replies each show a badge with different IDs; copying yields the exact IDs; a reply with no marker shows no badge.

### FR3: Notes photo → transcription
- **Upload endpoint (agent):** accepts a JSON body with an image data URL (png/jpeg/webp only), rejects anything else and anything over about 8 MB, stores it under the agent directory in an `uploads/` folder under a random UUID, and returns the id. Never use a client-supplied filename.
- **Composer (app):** the **+** button opens an image file picker. The chosen image is downscaled client-side to at most 1280 px on its longest side and re-encoded as JPEG (about 0.85 quality), uploaded to the agent endpoint (`AGENT_BASE_URL`), and the returned id is held until send. While attached, show "📎 notes attached" (and "uploading…" during upload). On send, append a marker of the form `[[upload:<id>]]` to the message text. Sending with only an attachment (no typed text) is allowed. Clear the attachment after send.
- **Message display:** strip the upload marker and show a small "📎 notes photo" chip in the message header.
- **Tool `read_notes`** (agent, built-in): input is the upload id (validated against a strict UUID/hex pattern to prevent path traversal). It reads the stored data URL and makes a vision chat completion to the router with the vision model (env `ZEROG_VISION_MODEL`), asking for a faithful markdown transcription of the notes followed by 3-6 key concepts, and instructing the model not to add facts that are not in the image. Returns `ok`, the notes text, and the request ID, or `ok: false` with a short error. Route its HTTP call through the traced HTTP layer so the request ID lands in the reply marker.
- Acceptance: a photo of printed notes yields a faithful transcription plus key concepts; a failed call yields a clear "couldn't read the notes" reply and no fabricated content.

### FR4: Tutor, flashcards, per-user streak
- **Tool `study_log`** (agent, built-in): input is a topic (max 120 chars) and 1-20 cards, each with a question and an answer. It appends a record to a per-user, per-day file under the agent directory (layout: `study/<userId>/<YYYY-MM-DD>.json`, UTC dates). Validate `userId` to a safe filename pattern.
- **User identity:** the backend already knows the sender. Pass the user id from the backend invoker through the request to the agent (the chat route already accepts a `userId` field), and make it available to the tools for the duration of that turn. Define the mechanism explicitly (for example, the tool factory receives a per-request context). Do not use a global variable that could leak between concurrent users.
- **Streak endpoint (agent):** returns, for a given user, the current streak (consecutive UTC days with at least one logged card; if today has no cards yet, count back from yesterday without breaking the streak), cards logged today, and total cards.
- **Usage endpoint (agent):** returns today's 0G call count, token total, and the last few request IDs.
- Acceptance: two different users have independent streaks and counts; the streak math handles consecutive days, a gap, and "not studied yet today".

### FR5: Pod agents (example agents)
Create three example agent directories beside `default-agent`, each with an agent config using the `zerog-router` provider (Telegram off), plus `SOUL.md` and `AGENTS.md`. The default agent config also switches to `zerog-router` and enables the study tools, so marketplace/tenant agents served by the shared runtime can call them.

Roles and rules:
- **study-note-reader.** Soul: precise, patient, never invents content. Rules: if the message has an upload marker, call `read_notes` with that id and reply with the cleaned notes and key concepts; if it fails, say so and do not guess; if there is no upload, work from the pasted text; end the reply with a final line containing only `@study-tutor`.
- **study-tutor.** Soul: explains simply, one concrete example per concept. Rules: explain the 2-3 hardest ideas in plain language; write 6 flashcards that test understanding, not wording recall; call `study_log` exactly once with the topic and cards; end with a final line containing only `@study-examiner`.
- **study-examiner.** Soul: friendly but exacting; quizzes, does not lecture. Rules: first turn asks ONE question harder than the card wording and tells the student to answer in the channel; later turns grade the answer (correct / partly / wrong with a one-line reason) then ask the next question; never @-mention anyone, so the cascade ends.

The existing cascade logic in `backend/src/agents/invoker.ts` follows @mentions in agent replies and passes the parent message along; confirm the three agents chain correctly and that the upload marker in the original user message is still visible to the Note Reader. If the cascade rewrites or truncates the user's text, fix it so the marker survives.

### FR6: Examiner follow-up UX
After an Examiner reply, prefill the composer with `@study-examiner ` (or auto-route the student's next message to it) so the quiz loop works without remembering to mention it. Acceptance: a three-turn exchange works.

### FR7: Status bar usage and streak
`StatusBar.tsx` additionally shows, on the right side before the wallet info:
- `⚡ N calls · T tokens today` from the usage endpoint
- `🔥 S-day streak · C cards today` from the streak endpoint, for the logged-in user

Poll about every 15 seconds. If the agent runtime is unreachable, hide both silently. Keep all existing wallet/balance behavior unchanged.

### FR8: Public-facing content (home page, pitch, metadata, docs)
Update all of the following so they describe Study Pod and contain no unverified or stale claims. Keep the existing visual design, layout and components; change copy and the minimum structure needed.

**Home page (`app/src/app/page.tsx`)**
- Hero badge: "Built on 0G Private Computer" (replaces "Live on 0G Mainnet — Aristotle").
- H1: "Your notes, studied by a pod of AI agents." (keep the colored accent on "studied").
- Subhead: photograph your notes; a Note Reader, a Tutor and an Examiner turn them into an explanation, flashcards and a quiz, powered by 0G Private Computer.
- Small line: come back tomorrow to keep your streak; every reply shows the 0G request ID that produced it.
- Primary CTA: "Start studying →" linking to the workspace; secondary CTA: Browse the Marketplace (unchanged).
- Trust row: "0G request ID on every reply", "Daily study streak", "ERC-7857 INFT agents".
- Nav link "0G Stack" becomes "Built on 0G".
- Problem section ("Why it matters"): re-reading notes is not studying; a single chatbot answers questions but does not quiz, track or bring you back; you cannot tell which model answered. Promise section ("Study Pod"): "A study group that never sleeps." Explain it runs inside 0G Study and every hand-off is visible. State that inference runs on 0G Private Computer and agent ownership lives on 0G Chain.
- How it works, four steps: Sign in (Privy, embedded wallet) → Open #study (the three agents are already invited) → Attach a photo of your notes → Learn and get quizzed (come back tomorrow to keep the streak).
- Features, six cards: Photo → notes; A pod of three agents; Flashcards that stick; Daily streak; Proof on every reply (request ID badge, copy it and match it in the 0G dashboard); Own your agents (ERC-7857 INFTs on 0G Chain).
- "Built on 0G" section heading: "Every step of the pod runs on 0G." Body: the "what breaks without 0G" sentence from section 2. Rows: Private Computer (chat and vision inference through the OpenAI-compatible router, with a request ID per call); 0G Chain (ERC-7857 INFT agents on the Galileo testnet); 0G Storage (encrypted agent metadata and skills for marketplace agents). **Remove** the 0G DA row and any "Sealed Inference on TDX + H100/H200" claim unless verified.
- Final CTA: heading "Study something today." with a one-line body about getting an explanation, flashcards and a quiz in a couple of minutes; button "Start studying".
- Footer: "0G Study — built on 0G Private Computer."

**Site metadata (`app/src/app/layout.tsx`)**
- Title: "0G Study — study your notes with a team of AI agents".
- Description: photograph your notes and a pod of AI agents explains them, writes flashcards and quizzes you; powered by 0G Private Computer with a request ID on every reply.
- Review the keyword list and Open Graph/Twitter text for stale claims.

**Pitch page (`app/src/app/pitch/page.tsx`)**
- Slide 1: tagline becomes Study Pod (photo of your notes in; explanation, flashcards and a quiz out; powered by 0G Private Computer). Tag chips: 0G Private Computer, Request IDs, ERC-7857 INFTs, Study streak.
- Slide 2 (problem): notes pile up and studying does not happen; students re-read or paste into a chatbot that never quizzes, never tracks, never says where the answer came from.
- Slide 3 (solution): "A study pod for your notes." Three agents read, teach and test in one channel; every hand-off visible; every reply has a 0G request ID. Replace the stat tiles with accurate ones for this product.
- Slide 4 (stack): "Every agent reply runs on 0G Private Computer." Rename the "Sealed Inference" card to "Private Computer" and describe it as TEE-verified inference through an OpenAI-compatible router with a copyable request ID.
- Slide 5 (live demo): remove "LIVE · 0G CHAIN 16661" (use "0G PRIVATE COMPUTER"); title "From a photo of notes to a quiz."; replace the terminal mock and the four step cards with the Study Pod flow; "What this proves": 0G request ID on every reply; vision + chat on Private Computer; per-day study streak; INFT agents on 0G Galileo.
- Slide 6 (sponsor stack): add a 0G Private Computer row as the first row; relabel 0G Chain as the INFT registry on the Galileo testnet; mark LiveKit as optional (not used by Study Pod) and render "optional" instead of a checkmark; change the footer sentence so it states that removing 0G Private Computer makes the pod do nothing.
- Slide 7 (why now): replace "0G Mainnet (Sept 2025) / Live since Aristotle launch" with a Private Computer card ("One OpenAI-compatible API for chat and vision on TEE-verified compute", highlight "Request ID on every call"); replace "Sealed TEE Inference" with a multimodal-models card ("Vision models can read a photo of your notes", highlight "Photo in, flashcards out").

**README and submission**
- README: add a "Study Pod — 0G Private Computer" section (what it is, why users return, where the code lives, how to run, the "what breaks" sentence, known limitations). Update the opening description and architecture bullets to mention Private Computer. Replace stale mainnet/Aristotle statements in "Why Now" with accurate ones.
- `submission.md`: fix the chain statement to "0G Galileo testnet, chainID 16602"; add the Study Pod description and the prize alignment; remove claims that are not actually implemented (for example fine-tuning loop, DA logs, escrow settlement) or label them clearly as planned.

Acceptance for FR8: a repo-wide search for "Aristotle", "16661", "mainnet" (in user-facing copy) and "H100" returns nothing stale; every page renders without layout breakage.

### FR9 (bonus): 0G account sign-in and credit balance
Goal: a user signs in with their 0G account, sees their credit balance, and watches it decrease.
- Obtain the 0G Privy app ID from the 0G team and set it in the app env. The prize page says it only works on `localhost:3000`, `3001` or `5173`.
- **UNVERIFIED / blocker:** how a signed-in 0G user's credits are spent and read (per-user router key, a credential accepted by the router, or a balance endpoint). Ask 0G (booth/Discord) and use only the documented mechanism. Do not invent an endpoint and do not fake a balance.
- If confirmed: store or forward the per-user credential server-side (never expose the shared key to the browser), have the agent use it for that user's calls, and show `Credits: X` in the status bar, re-read after each call. Gate everything behind a feature flag env var so the default demo is unaffected.
- If not confirmed in time: ship without it and say so plainly in the README.

## 8. Non-functional requirements

- **NFR1 Security.** `ZEROG_API_KEY` is server-side only (never a `NEXT_PUBLIC_*` variable). Protect the upload, usage and streak endpoints with an authentication check (shared secret or the existing JWT mechanism), restrict CORS to the app origin for these routes, cap upload size and uploads per user per day, validate all ids, and delete uploads older than 24 hours.
- **NFR2 Reliability.** If 0G is unreachable or a call fails, the agent says so in one plain line; no fabricated notes, no crash.
- **NFR3 Cost control.** A per-user daily cap on router calls (env `STUDY_DAILY_CALL_CAP`, default 30) with a friendly limit message.
- **NFR4 Privacy.** Document that notes photos are stored temporarily and removed after 24 hours; state exactly what 0G's TEE verification does and does not guarantee; make no stronger claim.
- **NFR5 Tests.** Add unit tests for: the traced HTTP layer (header present, header absent, non-JSON body, token parsing); today's usage aggregation; `study_log` (create, append); upload validation (type, size, bad id); streak math (consecutive days, a gap, today not yet studied, two users independent); the marker parsing helper (request IDs, upload marker, both, neither). Keep every existing test passing.

## 9. Environment variables

Agent
- `ZEROG_API_KEY` (required for `zerog-router`)
- `ZEROG_LLM_MODEL`, `ZEROG_VISION_MODEL` (real IDs from step 1)
- `ZEROG_BASE_URL` (optional)
- `STUDY_DAILY_CALL_CAP` (default 30)
- A shared secret or JWT settings for NFR1

App
- `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_AGENT_BASE_URL`, `NEXT_PUBLIC_BONFIRE_BASE_URL`
- An optional feature flag for FR9

Update the `.env.example` files accordingly.

## 10. Work plan for Claude Code (do in order, commit after each step)

0. **Baseline.** Install dependencies; run agent tests and type-checks for `agent`, `backend`, `app`; record results.
1. **Smoke-test the router** (a throwaway script under `agent/scripts/`). With a real `ZEROG_API_KEY`: list models, make one chat completion, make one vision completion with a small test image. Print all response headers and the body `id`. Use the output to settle G1, G2, G9, and write the real model IDs into `.env.example`. If the key or endpoints fail, stop and report.
2. **FR1 and FR2 (agent side).** New provider, enum widening everywhere, traced HTTP layer, reply marker. Tests.
3. **FR3 and FR4.** Upload endpoint, `read_notes`, `study_log`, per-request user context, streak and usage endpoints. Tests.
4. **FR5.** Example agents and default-agent config; verify the cascade end to end against the real router (photo → reader → tutor → examiner) and confirm the upload marker survives the cascade.
5. **UI.** FR2 badge, FR3 composer attach and chips, FR6 follow-up, FR7 status bar. Unit-test the marker helper.
6. **FR8 content.** Home page, metadata, pitch page, README, submission, per section 7. Then run the stale-claims search.
7. **NFR1 and NFR3 hardening.**
8. **Seed script or README steps** that create the study server, `#study` channel and the three agents so a fresh clone reaches the demo state quickly.
9. **FR9** only after 0G confirms the mechanism.
10. **Deploy** (app and agent+backend) with a funded shared key and the daily cap; record the demo.

After each step: run type-checks and tests, then summarize what changed and what is still unverified. Do not mark a step done if it was not run against the real API where the step says so.

## 11. Demo script (under 3 minutes)

1. (0:00-0:15) Problem: notes pile up, nobody quizzes you. One line on 0G Study.
2. (0:15-0:45) Attach a photo of handwritten notes, mention `@study-note-reader`. Show the transcription and the `0G · <id>` badge; click to copy.
3. (0:45-1:25) Tutor explains and writes flashcards; streak goes to 1, cards to 6; show the Tutor's request ID.
4. (1:25-2:00) Examiner asks a question; answer it; show grading.
5. (2:00-2:25) Show usage climbing in the status bar; open the 0G dashboard and show the same request IDs.
6. (2:25-2:45) Bonus, only if FR9 works: sign in with a 0G account on localhost and show the credit balance dropping.
7. (2:45-3:00) The "what breaks without 0G" sentence; what's next (spaced repetition, more subjects).

Prepare printed and handwritten notes and a second pre-seeded user to show independent streaks.

## 12. Submission checklist

- [ ] Public repo with README, setup steps, env examples, and the "what breaks" sentence
- [ ] Demo video under 3 minutes and a live demo link
- [ ] Contract address: `BonFireAgentINFT` `0x151819ebc4435937f704FbB726DE6f99Bda262Bb` (0G Galileo, 16602); add any new contracts
- [ ] Team names with Telegram and X handles
- [ ] Real request IDs from the demo run pasted into the submission text
- [ ] No claim of the credit-balance flow unless FR9 actually works

## 13. Optional second prize: "Keep Building on 0G" ($3,000, Continuity Track)

The repo is prior 0G work, so it may qualify. Requirements: a dated commit hash marking the pre-hackathon state, a dated changelog of work done in the Mumbai window, a new 0G request ID / Storage root hash / contract address from this hackathon, and a short "What's next". Confirm on the prize page that one project can enter both before relying on it. If pursued, add a Mumbai changelog file and record the starting commit.

## 14. Open questions

1. Real model IDs and the request-ID header (answered by step 1).
2. How a signed-in 0G account's credits are spent and read (FR9).
3. Is pre-hackathon git history available (section 13)?
4. Hosting target and budget for the shared demo key.
5. Team contact details for the submission.