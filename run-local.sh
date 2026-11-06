#!/usr/bin/env bash
# 0G Study — one-command local run (macOS/Linux).
#   ./run-local.sh                 check 0G, start agent :7777, backend :8080, app :3000
#   ./run-local.sh seed <owner>    after signing in once, create Study server + #study + pod agents
#   ./run-local.sh stop            stop everything
#   ./run-local.sh --prod          same as start, but the app is a production build (no file watchers; best for demos)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; LOGS="$ROOT/.logs"; mkdir -p "$LOGS"
c() { printf "\033[1;36m%s\033[0m\n" "$*"; }; die() { printf "\033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

stop() { for p in 7777 8080 3000 27018; do lsof -ti tcp:$p | xargs kill 2>/dev/null || true; done; c "stopped"; }

if [[ "${1:-}" == "stop" ]]; then stop; exit 0; fi
if [[ "${1:-}" == "seed" ]]; then
  [[ -n "${2:-}" ]] || set -- seed auto
  cd "$ROOT/backend" && exec ./node_modules/.bin/tsx scripts/seed-study-pod.mjs --owner "$2"
fi

# macOS defaults to 256 open files per process; file watchers + study data exceed it (EMFILE crash).
ulimit -n 10240 2>/dev/null || ulimit -n 4096 2>/dev/null || true

# --- preflight
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || die "Node >= 20 required (have $(node -v))"
for d in agent backend app; do [[ -d "$ROOT/$d/node_modules" ]] || die "$d/node_modules missing — run: pnpm install && (cd app && npm install)"; done
grep -qE '^PRIVY_APP_ID=.+' backend/.env 2>/dev/null || die "Set PRIVY_APP_ID and PRIVY_APP_SECRET in backend/.env (dashboard.privy.io)"
grep -qE '^PRIVY_APP_SECRET=.+' backend/.env || die "Set PRIVY_APP_SECRET in backend/.env"
grep -qE '^NEXT_PUBLIC_PRIVY_APP_ID=.+' app/.env.local || die "Set NEXT_PUBLIC_PRIVY_APP_ID in app/.env.local"
grep -qE '^ZEROG_API_KEY=sk-' agent/.env || die "Set ZEROG_API_KEY in agent/.env (pc.0g.ai)"
stop >/dev/null

c "1/4  Checking 0G Private Computer (models, chat, vision)…"
SMOKE="$(cd agent && node scripts/smoke-router.mjs ../scripts/fixtures/notes-sample.png 2>&1 || true)"
echo "$SMOKE" | grep -E "models:|FAILED|^OK" || true
if ! echo "$SMOKE" | grep -qE "chat=200"; then
  echo "$SMOKE" | tail -15; die "0G chat call failed — key funded? ZEROG_LLM_MODEL current?"
fi
if ! echo "$SMOKE" | grep -qE "vision=200"; then
  echo "$SMOKE" | grep -A3 "vision (" | grep -E "error body|reply" | cut -c1-400
  printf "\033[1;33m⚠ Vision model unavailable on 0G right now — app will start, but photo reading fails.\n  Pick another vision model from the 'models:' list above and set ZEROG_VISION_MODEL in agent/.env\033[0m\n"
fi

c "2/4  Starting agent runtime on :7777"
(cd agent && nohup ./node_modules/.bin/tsx src/index.ts examples/default-agent >"$LOGS/agent.log" 2>&1 &)
c "3/4  Starting backend on :8080 (in-memory MongoDB on :27018)"
(cd backend && DEV_MEMORY_MONGO=1 nohup ./node_modules/.bin/tsx src/index.ts >"$LOGS/backend.log" 2>&1 &)
c "4/4  Starting app on :3000"
if [[ "${1:-}" == "--prod" ]]; then
  c "     building the app for production (about a minute)…"
  (cd app && ./node_modules/.bin/next build >"$LOGS/app-build.log" 2>&1) || die "app build failed — see .logs/app-build.log"
  (cd app && nohup ./node_modules/.bin/next start -p 3000 >"$LOGS/app.log" 2>&1 &)
else
  # Poll instead of OS file watches: macOS runs out of watches (EMFILE) and Next then serves 404 for every page.
  (cd app && WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=1 nohup ./node_modules/.bin/next dev >"$LOGS/app.log" 2>&1 &)
fi

wait_port() { for _ in $(seq 1 90); do nc -z localhost "$1" 2>/dev/null && return 0; sleep 1; done; die "$2 didn't come up — see .logs/$2.log"; }
wait_port 7777 agent; wait_port 8080 backend; wait_port 3000 app
c "✓ All up.  Logs: tail -f .logs/*.log"
cat <<MSG

  Next:
   1. Open http://localhost:3000 and sign in with Privy (creates your user).
   2. ./run-local.sh seed <your-username-or-email>
      (re-run after restarting — the dev DB is in memory)
   3. Study → #study → attach a notes photo → send "@study-note-reader"

  Stop everything: ./run-local.sh stop
MSG
