#!/bin/sh
# Boot the agent with its directory on a persistent volume.
#
# A volume mounted at $AGENT_DIR hides whatever the image put there, so the defaults live in
# /app/defaults/agent and are copied in here, one file at a time and only when missing: a redeploy
# must never overwrite study data, a skill the agent installed or a tenant edit. New rules in a newer
# image reach an existing volume through the seed (PATCH /tenants), not through this copy.
set -eu

AGENT_DIR="${AGENT_DIR:-/agent}"
DEFAULTS_DIR="${DEFAULTS_DIR:-/app/defaults/agent}"
TENANTS_FILE="${TENANTS_FILE:-$AGENT_DIR/data/tenants.json}"
BAKED_TENANTS="${BAKED_TENANTS:-/app/data/tenants.json}"
export AGENT_DIR TENANTS_FILE

mkdir -p "$AGENT_DIR" "$(dirname "$TENANTS_FILE")"

copied=0
cd "$DEFAULTS_DIR"
for f in $(find . -type f); do
  if [ ! -e "$AGENT_DIR/$f" ]; then
    mkdir -p "$(dirname "$AGENT_DIR/$f")"
    cp "$f" "$AGENT_DIR/$f"
    copied=$((copied + 1))
  fi
done
cd - >/dev/null

if [ ! -e "$TENANTS_FILE" ]; then
  cp "$BAKED_TENANTS" "$TENANTS_FILE"
  copied=$((copied + 1))
fi
echo "entrypoint: $copied default file(s) copied into $AGENT_DIR"

exec "$@"
