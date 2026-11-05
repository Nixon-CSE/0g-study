# 0G Study — app

The Next.js 14 UI for 0G Study / BonFire: the landing page, pitch deck, marketplace and the Discord-style workspace where the Study Pod runs. It is an **npm** tree (not part of the pnpm workspace) and deploys to Vercel with the project's Root Directory set to `app`.

## Run

```bash
npm install
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_PRIVY_APP_ID, backend + agent URLs
npm run dev                         # http://localhost:3000
```

It needs the backend (`:8080`) and the agent runtime (`:7777`) running — see the [root README](../README.md).

| Command | |
|---|---|
| `npm run dev` / `npm run build` / `npm run start` | Next.js |
| `npm run lint` | ESLint (flat config) |
| `npx vitest run` | unit tests (`src/lib/__tests__`) |
| `npx tsc --noEmit` | type-check |

If `next build` hangs at "Generating static pages" or `next dev` never gets past "Starting…" on your machine, build with `NEXT_BUILD_IN_PROCESS=1` (renders in worker threads instead of child processes).

## Routes

| Route | What |
|---|---|
| `/` | Landing page (Study Pod), designed to [DESIGN.md](../DESIGN.md) |
| `/pitch` | Seven-slide pitch deck (arrow keys) |
| `/workspace` | Servers, channels, the agent sidebar, voice — where `#study` lives |
| `/marketplace` | Browse, create and mint INFT agents |
| `/dm/[agentId]` | Direct messages with one agent |
| `/login`, `/register` | Privy sign-in |

## Study Pod pieces

| File | Does |
|---|---|
| [src/components/message/MessageComposer.tsx](src/components/message/MessageComposer.tsx) | **+** attaches a notes photo (downscaled to ≤1280 px JPEG, uploaded to the agent), appends `[[upload:id]]`; pre-fills `@study-examiner` after the Examiner replies |
| [src/components/message/MessageRow.tsx](src/components/message/MessageRow.tsx) | Strips markers; shows the `0G · <id>` request-ID badge (click to copy) and the 📎 photo chip |
| [src/lib/study-markers.ts](src/lib/study-markers.ts) | Pure parser for `⟦0g:…⟧` and `[[upload:…]]` markers (unit-tested) |
| [src/components/layout/StatusBar.tsx](src/components/layout/StatusBar.tsx) | `⚡ calls · tokens today` and `🔥 streak · cards today`, polled every 15 s |
| [src/components/layout/ZeroGAccount.tsx](src/components/layout/ZeroGAccount.tsx) | FR9: "Connect 0G account" and `Credits: X 0G` (when `NEXT_PUBLIC_ZEROG_ACCOUNTS=on`) |
| [src/lib/agent-study.ts](src/lib/agent-study.ts) | Calls the agent's study endpoints with a short-lived study token from the backend |

## Environment

See [.env.local.example](.env.local.example). Everything here is `NEXT_PUBLIC_*` and therefore public — never put a 0G `sk-`/`mk-` key or any server secret in this file.
