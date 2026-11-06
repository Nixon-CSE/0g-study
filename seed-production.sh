#!/usr/bin/env bash
# Seed the deployed Study Pod from your laptop:  ./seed-production.sh <your-username-or-email>
# Reads .env.production (gitignored; template in scripts/env.production.template). Sign in to the deployed
# app once first, so your user exists. Safe to re-run: it also pushes the current AGENTS.md / SOUL.md to the
# tenants on the volume, so run it after changing the pod's rules.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT/.env.production"
[[ -n "${1:-}" ]] || { echo "usage: ./seed-production.sh <your-username-or-email>"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing .env.production: cp scripts/env.production.template .env.production, then fill it in."; exit 1; }
set -a; . "$ENV_FILE"; set +a
for v in MONGODB_URI MONGODB_DB EMBER_AGENT_BASE_URL AGENT_PUBLIC_URL AGENT_ADMIN_TOKEN; do
  [[ -n "${!v:-}" ]] || { echo "$v is empty in .env.production"; exit 1; }
done
curl -sf -m 15 "$AGENT_PUBLIC_URL/health" >/dev/null || { echo "Can't reach the agent at AGENT_PUBLIC_URL ($AGENT_PUBLIC_URL)"; exit 1; }
echo "Seeding database \"$MONGODB_DB\" via $AGENT_PUBLIC_URL (agents will use $EMBER_AGENT_BASE_URL)"
cd "$ROOT/backend" && exec ./node_modules/.bin/tsx scripts/seed-study-pod.mjs --owner "$1"
