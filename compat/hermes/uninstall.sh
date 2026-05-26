#!/usr/bin/env bash
set -euo pipefail

HOST="${HERMES_HOST:-hermes-vm}"
REMOTE_DIR="~/.hermes/skills/compat/mda-compat-hermes"

ssh "$HOST" "rm -rf $REMOTE_DIR && echo removed: $REMOTE_DIR" || echo "nothing to remove at $HOST:$REMOTE_DIR"

# Best-effort: drop the parent `compat` category dir if it's now empty.
ssh "$HOST" "rmdir ~/.hermes/skills/compat 2>/dev/null || true"
