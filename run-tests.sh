#!/usr/bin/env bash
# 0G Study — full test run.
#   ./run-tests.sh            unit + integration for agent, backend, app (+ contracts) and, if the stack is up, live E2E
#   ./run-tests.sh --offline  same, but the live E2E spends no 0G credits
#   ./run-tests.sh --quick    skip lint and contracts
# Writes a summary to .logs/test-summary.txt
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; LOGS="$ROOT/.logs"; mkdir -p "$LOGS"
OFFLINE=""; QUICK=""
for a in "$@"; do case "$a" in --offline) OFFLINE="--offline";; --quick) QUICK=1;; esac; done
SUMMARY="$LOGS/test-summary.txt"; : > "$SUMMARY"
pass=0; fail=0
step() { # name, dir, command...
  local name="$1" dir="$2"; shift 2
  local log="$LOGS/test-$(echo "$name" | tr ' /' '__').log"
  printf "\033[1;36m▶ %s\033[0m\n" "$name"
  if (cd "$ROOT/$dir" && "$@") >"$log" 2>&1; then
    local stat; stat=$(grep -E "Tests +[0-9]+ (passed|failed)|passing|^ *[0-9]+ passing" "$log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g' | xargs)
    printf "  \033[32m✓ pass\033[0m %s\n" "$stat"; echo "PASS  $name  $stat" >> "$SUMMARY"; pass=$((pass+1))
  else
    printf "  \033[31m✗ FAIL\033[0m — last lines of %s:\n" "${log#$ROOT/}"; tail -25 "$log" | sed 's/^/    /'
    echo "FAIL  $name  (see ${log#$ROOT/})" >> "$SUMMARY"; fail=$((fail+1))
  fi
}
B="./node_modules/.bin"

step "agent typecheck"     agent   $B/tsc --noEmit
step "agent tests"         agent   $B/vitest run
step "backend typecheck"   backend $B/tsc --noEmit
step "backend tests"       backend env OG_STORAGE_MOCK=1 $B/vitest run
step "app typecheck"       app     $B/tsc --noEmit
step "app tests"           app     $B/vitest run
if [[ -z "$QUICK" ]]; then
  step "app lint"          app     npm run lint --silent
  [[ -x "$ROOT/contracts/node_modules/.bin/hardhat" ]] && step "contracts tests" contracts ./node_modules/.bin/hardhat test
fi
if curl -sf -m 3 http://localhost:7777/health >/dev/null && curl -sf -m 3 http://localhost:8080/health >/dev/null; then
  step "live e2e" . agent/node_modules/.bin/tsx scripts/e2e-live.mjs $OFFLINE
  [[ -f "$LOGS/test-live_e2e.log" ]] && sed 's/\x1b\[[0-9;]*m//g' "$LOGS/test-live_e2e.log" | grep -E "✓|✗|○|Live E2E" | sed 's/^/    /'
else
  echo "SKIP  live e2e  (start the stack with ./run-local.sh)" >> "$SUMMARY"
  printf "\033[33m○ live e2e skipped — start the stack with ./run-local.sh\033[0m\n"
fi
echo; printf "\033[1m%s passed, %s failed\033[0m — summary in .logs/test-summary.txt\n" "$pass" "$fail"
[[ $fail -eq 0 ]]
