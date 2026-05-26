#!/usr/bin/env bash
set -euo pipefail

# Live install: scps the MDA-compiled SKILL.md to hermes-vm and drops it
# into ~/.hermes/skills/compat/mda-compat-hermes/SKILL.md. Hermes Agent
# discovers skills via its `~/.hermes/skills/<category>/<name>/SKILL.md`
# layout. `compat` is a fresh category we add for this kit.
#
# Idempotent. Use with uninstall.sh.
#
# Override the SSH target by setting HERMES_HOST (default: hermes-vm).

HOST="${HERMES_HOST:-hermes-vm}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/compat/hermes/build/SKILL.md"
REMOTE_DIR="~/.hermes/skills/compat/mda-compat-hermes"

if [ ! -f "$SOURCE" ]; then
  echo "build/SKILL.md missing — run ./verify.sh first" >&2
  exit 1
fi

ssh "$HOST" "mkdir -p $REMOTE_DIR"
scp -q "$SOURCE" "$HOST:$REMOTE_DIR/SKILL.md"

echo "installed: $HOST:$REMOTE_DIR/SKILL.md"
echo
echo "next: ssh $HOST 'hermes skills list | grep mda-compat-hermes'"
echo "      ssh $HOST 'hermes skills inspect mda-compat-hermes'"
echo
echo "to remove: ./compat/hermes/uninstall.sh"
