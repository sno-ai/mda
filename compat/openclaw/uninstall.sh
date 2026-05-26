#!/usr/bin/env bash
set -euo pipefail

# OpenClaw has no `skills uninstall` subcommand. Remove the managed dir
# directly. Safe — only touches a dir whose name matches our install slug.

HOST="${OPENCLAW_HOST:-openclaw-vm}"
REMOTE_DIR="~/.openclaw/skills/mda-compat-openclaw"

ssh "$HOST" "rm -rf $REMOTE_DIR && echo removed: $REMOTE_DIR" || echo "nothing to remove at $HOST:$REMOTE_DIR"
