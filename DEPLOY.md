# Deploying 0G Study

**MongoDB Atlas**, two **Railway** services from this repo (agent, backend), and the app on **Vercel**.

```
browser ──► app (Vercel, Next.js)
   │  Privy token                         ▲
   ├──────────► backend (Railway) ── MongoDB Atlas
   │                 │  @mention cascade, study tokens
   │                 │  private network: http://agent.railway.internal:7777
   │  study token    ▼
   └──────────► agent (Railway, volume at /agent) ──► 0G Private Computer
```

Do the steps in order. Each URL depends on an earlier one, so **the first Railway deploys fail on purpose**: both services refuse to start until their variables are set.

Paste secrets into the dashboards only. Never commit them or send them in chat.

## 1. Generate new secrets

Use new values, not the ones in your local `.env` files:

```bash
openssl rand -hex 32   # JWT_SECRET: goes on the backend, and on the agent as STUDY_JWT_SECRET
openssl rand -hex 32   # AGENT_ADMIN_TOKEN: goes on both
```

Create a new `sk-` key at [pc.0g.ai → API Keys](https://pc.0g.ai/dashboard/api-keys) named `0g-study-production`, on an account with credits. That's `ZEROG_API_KEY`.

## 2. Railway: create the services

**agent**

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo** → `Nixon-CSE/0g-study`.
2. Click the service → **Settings**:
   - **Service name:** exactly `agent`. It becomes the private host `agent.railway.internal`.
   - **Source → Root Directory:** `agent`
   - **Source → Branch:** `main`
   - **Deploy → Healthcheck Path:** `/health`
   - **Deploy → Replicas:** leave at 1. A volume attaches to one instance.
3. **Variables:** add `RAILWAY_DOCKERFILE_PATH` = `docker/Dockerfile`. It's relative to the Root Directory. If the build log says the Dockerfile wasn't found, try `agent/docker/Dockerfile`.
4. **Volume:** right-click the service on the canvas → **Attach volume**, mount path **`/agent`**. Everything the agent writes goes there: `study/<user>/` (streaks, flashcards, `rag.json`, `rag-pending.json`, `zerog-keys.enc`), `uploads/`, `memory/`, `rag/kb/`, `data/tenants.json`, installed skills.
5. **Settings → Networking → Generate Domain.** Note it as `<AGENT_URL>`.

**backend**

1. In the same project: **+ Create** → **GitHub Repo** → the same repo. Same environment, or the private network won't connect them.
2. **Settings:** service name `backend`, **Root Directory** `backend`, **Branch** `main`, **Healthcheck Path** `/health`. It finds `Dockerfile` on its own.
3. **Settings → Networking → Generate Domain.** Note it as `<BACKEND_URL>`.

## 3. Vercel: deploy the app

1. [vercel.com/new](https://vercel.com/new) → import `Nixon-CSE/0g-study`.
2. **Root Directory:** `app`. Framework: Next.js.
3. Add the [app variables](#app-vercel) with `<AGENT_URL>` and `<BACKEND_URL>`. Leave `NEXT_PUBLIC_SITE_URL` for now.
4. **Deploy.** Note the production URL as `<APP_URL>` (no trailing slash).
5. **Settings → Environment Variables:** set `NEXT_PUBLIC_SITE_URL` to `<APP_URL>`, then **Deployments → Redeploy**. `NEXT_PUBLIC_*` values are built in, so any change needs a redeploy.

Preview URLs differ from `<APP_URL>`, so they can't reach the backend or agent. Use the production URL.

## 4. Railway: set the variables

Add these on each service, then deploy. **Must match** means the value has to be identical on both.

### agent

| Variable | Value | Must match |
|---|---|---|
| `PORT` | `7777`, so the private URL has a fixed port | backend `EMBER_AGENT_BASE_URL` |
| `RAILWAY_DOCKERFILE_PATH` | `docker/Dockerfile` (step 2) | |
| `ZEROG_API_KEY` | the new `sk-` key from step 1 | |
| `ZEROG_LLM_MODEL` | `deepseek-v4.1-flash` | |
| `ZEROG_EXAMINER_MODEL` | unset (the tenant's `0gm-1.0-35b-a3b`) | optional: overrides the Examiner's model, e.g. `deepseek-v4.1-flash` if 0gm is down |
| `ZEROG_VISION_MODEL` | `gemini-2.5-flash` | |
| `ZEROG_EMBED_MODEL` | `qwen3-embedding-0.6b` | |
| `STUDY_JWT_SECRET` | from step 1 | backend `JWT_SECRET` |
| `STUDY_ALLOWED_ORIGINS` | `<APP_URL>` (comma-separated if several) | |
| `AGENT_ADMIN_TOKEN` | from step 1 | backend `AGENT_ADMIN_TOKEN` |
| `ZEROG_USER_ACCOUNTS` | `on` | app `NEXT_PUBLIC_ZEROG_ACCOUNTS` |
| `STUDY_DAILY_CALL_CAP` | `30`. Shared-key calls per student per day; a pod run is about 10 | |
| `STUDY_DAILY_UPLOAD_CAP` | `20` | |

`NODE_ENV=production`, `AGENT_DIR=/agent` and `TENANTS_FILE=/agent/data/tenants.json` are set by the image. Without `AGENT_ADMIN_TOKEN`, `STUDY_JWT_SECRET` (both at least 32 characters) or `STUDY_ALLOWED_ORIGINS`, the agent refuses to start and the deploy log says which one is missing.

### backend

| Variable | Value | Must match |
|---|---|---|
| `MONGODB_URI` | your Atlas connection string | |
| `MONGODB_DB` | `bonfire` | |
| `JWT_SECRET` | from step 1 | agent `STUDY_JWT_SECRET` |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET` | dashboard.privy.io → your app → API keys | app `NEXT_PUBLIC_PRIVY_APP_ID` |
| `CORS_ORIGINS` | `<APP_URL>` | |
| `EMBER_AGENT_BASE_URL` | `http://agent.railway.internal:7777` | agent `PORT`, and every agent's `baseUrl` |
| `AGENT_ADMIN_TOKEN` | from step 1 | agent `AGENT_ADMIN_TOKEN` |

`NODE_ENV=production` is set by the image.

**Leave `OG_STORAGE_MOCK` unset.** Mock storage writes to the container's disk, which vanishes on every deploy, and the Study Pod doesn't use 0G Storage at all. The backend refuses to start with it on, and with `DEV_MEMORY_MONGO` on. The same goes for a missing `MONGODB_URI`, Privy keys, `CORS_ORIGINS` or `EMBER_AGENT_BASE_URL`.

Optional: `INFT_CONTRACT_ADDRESS` + `PLATFORM_EXECUTOR_PRIVATE_KEY` (INFT minting), `KNOWLEDGE_RAG=off`, `DAILY_API_KEY` (voice). Study Pod needs none of them.

**Why `EMBER_AGENT_BASE_URL` matters.** `agentFetch` attaches the admin token only to that origin, and it has to be the origin in each agent's `baseUrl`. If they differ, `studentId` is dropped and pods run without a student. The seed in step 7 sets `baseUrl` to `EMBER_AGENT_BASE_URL`, so re-seed if you change it.

**If the private network doesn't work** (replies say `(agent unreachable)` in the backend's logs and #study): set `EMBER_AGENT_BASE_URL` to `<AGENT_URL>`, update `.env.production` to match, redeploy and re-seed. Everything else stays the same.

### app (Vercel)

| Variable | Value | Must match |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | your Privy app ID | backend `PRIVY_APP_ID` |
| `NEXT_PUBLIC_BONFIRE_BASE_URL` | `<BACKEND_URL>` | |
| `NEXT_PUBLIC_AGENT_BASE_URL` | `<AGENT_URL>` (the public one: browsers can't reach the private host) | |
| `NEXT_PUBLIC_SITE_URL` | `<APP_URL>` | |
| `NEXT_PUBLIC_OG_CHAIN_ID` | `16602` | |
| `NEXT_PUBLIC_INFT_CONTRACT_ADDRESS` | `0x151819ebc4435937f704FbB726DE6f99Bda262Bb` | |
| `NEXT_PUBLIC_ZEROG_ACCOUNTS` | `on` | agent `ZEROG_USER_ACCOUNTS` |

Never put a secret in a `NEXT_PUBLIC_*` variable: `ZEROG_API_KEY`, `sk-`/`mk-` keys, `JWT_SECRET`, `AGENT_ADMIN_TOKEN` or `PRIVY_APP_SECRET`.

## 5. Check Atlas

**Network Access** must allow Railway, whose outbound IPs aren't fixed, so `0.0.0.0/0` with a strong database password. The backend's `/health` shows `"db":true` when it's connected.

## 6. Privy

[dashboard.privy.io](https://dashboard.privy.io) → your app → **Configuration → App settings → Domains** → add `<APP_URL>` to **Allowed origins**. Without it, sign-in fails on the deployed app.

Then open `<APP_URL>` and sign in once, so your user exists.

## 7. Seed production

From your laptop, once, and again after changing pod rules:

```bash
cp scripts/env.production.template .env.production   # gitignored; fill in the values
./seed-production.sh <your-username-or-email>
```

`AGENT_PUBLIC_URL` is `<AGENT_URL>`: your laptop can't reach `*.railway.internal`, so tenants are registered through the public URL with the admin token, while each agent's stored `baseUrl` stays `EMBER_AGENT_BASE_URL`.

This creates the Study server, #study and the three pod agents, and pushes the current `AGENTS.md`/`SOUL.md` to the tenants on the volume. A new image never overwrites those by itself.

## 8. Smoke test

```bash
node scripts/smoke-deployed.mjs <APP_URL> <BACKEND_URL> <AGENT_URL>
```

It makes no model calls and needs no keys: health, 401s, locked admin routes, `/usage` 401, CORS for the app but not for a stranger.

Then a real run in `<APP_URL>`: **Study → #study**, attach a notes photo, send `@study-note-reader`. Expect three replies, each with a `0G · …` badge, and the streak and cards to go up. The reply's request IDs appear in the pc.0g.ai dashboard.

## Things to know

- **Redeploys keep data.** The image's defaults live in `/app/defaults/agent`, and `docker/entrypoint.sh` copies them into the volume only when a file is missing. Without the volume, streaks and study memory reset on every deploy.
- **Don't change `STUDY_JWT_SECRET` casually.** It also encrypts students' stored 0G keys, so a new value means they reconnect. It must stay equal to the backend's `JWT_SECRET`.
- **Railway's limits:** a request with no data for 5 minutes is closed. A pod's single POST takes 1 to 3 minutes, so it fits. Photo uploads are limited by the agent (about 8 MB, 413 above that); Railway documents no body-size limit.
- **Lockfiles:** the images build from `agent/pnpm-lock.yaml` and `backend/pnpm-lock.yaml`, not the workspace one, and a stale lockfile fails the build. After changing a dependency: `cd agent && pnpm install --ignore-workspace --lockfile-only` (same for `backend`).
- **Proof before deploying:** CI's `docker` job builds both images from those contexts and boots them on an empty volume.
