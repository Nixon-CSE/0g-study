# Deploying 0G Study

Three services plus MongoDB. A setup that works: **app on Vercel**, **agent + backend as Docker services** (Railway, Render, Fly — anything that builds a Dockerfile), **MongoDB Atlas** (or the host's Mongo add-on).

```
browser ──► app (Vercel, Next.js)
   │  Privy token            ▲
   ├──────────► backend (:8080) ── MongoDB
   │                 │  @mention cascade, study tokens
   │  study token    ▼
   └──────────► agent (:7777) ──► 0G Private Computer (router-api.0g.ai)
```

## 1. MongoDB

Create a database and note the connection string (`MONGODB_URI`) and name (`MONGODB_DB`, e.g. `bonfire`).

## 2. Agent (`agent/`)

- **Build:** Dockerfile `agent/docker/Dockerfile`, build context `agent/`.
- **Port:** listens on `$PORT` if the host sets it, else `AGENT_API_PORT`, else 7777.
- **Volume (recommended):** mount persistent storage at `/agent` (study logs, flashcards, uploads, users' encrypted 0G keys) and `/app/data` (tenant registry). Without one, streaks reset on every deploy.

| Variable | Value |
|---|---|
| `ZEROG_API_KEY` | shared `sk-` key from pc.0g.ai (fund the deposit) |
| `ZEROG_LLM_MODEL` | `deepseek-v4.1-flash` (re-check with `node scripts/smoke-router.mjs`) |
| `ZEROG_VISION_MODEL` | `qwen2.5-vl-72b-instruct` |
| `STUDY_JWT_SECRET` | **same value as the backend's `JWT_SECRET`** — without it the study endpoints are open |
| `STUDY_ALLOWED_ORIGINS` | the app's URL, e.g. `https://0g-study.vercel.app` |
| `STUDY_DAILY_CALL_CAP` / `STUDY_DAILY_UPLOAD_CAP` | `30` / `20` (defaults) |
| `ZEROG_USER_ACCOUNTS` | `on` to enable "Connect 0G account" (FR9), else `off` |

## 3. Backend (`backend/`)

- **Build:** Dockerfile `backend/Dockerfile`, build context `backend/`. Listens on `$PORT` (default 8080).

| Variable | Value |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | from step 1 |
| `JWT_SECRET` | random, ≥ 32 chars (`openssl rand -hex 32`); copy it to the agent's `STUDY_JWT_SECRET` |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | from dashboard.privy.io |
| `CORS_ORIGINS` | the app's URL |
| `OG_RPC_URL` | `https://evmrpc-testnet.0g.ai` (default) |
| `INFT_CONTRACT_ADDRESS`, `PLATFORM_EXECUTOR_PRIVATE_KEY` | optional — only for INFT minting / marketplace bundles |
| `DAILY_API_KEY` etc. | optional — voice channels, not used by Study Pod |

Then seed the demo state once (run it from your machine, or as a one-off job on the host, with the production `MONGODB_URI` and `EMBER_AGENT_BASE_URL=<agent URL>`), after you have signed in to the deployed app once:

```bash
cd backend && pnpm tsx scripts/seed-study-pod.mjs --owner <your-username-or-email>
```

## 4. App (`app/`) on Vercel

- **Root Directory: `app`** (the repo root is not a Next.js app). Framework: Next.js. Install: `npm install`.
- In Privy, add the Vercel URL to the app's allowed origins.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | your Privy app ID |
| `NEXT_PUBLIC_BONFIRE_BASE_URL` | backend URL (no trailing slash) |
| `NEXT_PUBLIC_AGENT_BASE_URL` | agent URL (no trailing slash) |
| `NEXT_PUBLIC_SITE_URL` | the app's own URL (social cards) |
| `NEXT_PUBLIC_OG_CHAIN_ID` | `16602` |
| `NEXT_PUBLIC_INFT_CONTRACT_ADDRESS` | `0x151819ebc4435937f704FbB726DE6f99Bda262Bb` |
| `NEXT_PUBLIC_ZEROG_ACCOUNTS` | `on` to show "Connect 0G account" (match the agent) |

Never put `ZEROG_API_KEY` or any `sk-`/`mk-` key in a `NEXT_PUBLIC_*` variable.

## 5. Smoke test the deployment

1. Open the app, sign in, open **Study → #study**.
2. Attach a notes photo, send `@study-note-reader`. Expect three replies, each with a `0G · …` badge, and the status bar's streak/cards to go up.
3. From your machine: `curl -s <agent URL>/usage` must return **401** (proves `STUDY_JWT_SECRET` is set).
4. Copy a request ID and find it in the pc.0g.ai dashboard. Paste three of them into `submission.md`.
