#!/usr/bin/env bash
set -euo pipefail

# Live install: scps the MDA-compiled SKILL.md into a temp directory on
# openclaw-vm, then runs `openclaw skills install --global` against that dir.
# OpenClaw copies the SKILL.md into ~/.openclaw/plugin-skills/<slug>/ and
# treats it as a managed global skill.
#
# Idempotent (uses --force). Use with uninstall.sh.
#
# Override the SSH target by setting OPENCLAW_HOST (default: openclaw-vm).

HOST="${OPENCLAW_HOST:-openclaw-vm}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/compat/openclaw/build/SKILL.md"
REMOTE_TMP="/tmp/mda-compat-openclaw"

if [ ! -f "$SOURCE" ]; then
  echo "build/SKILL.md missing — run ./verify.sh first" >&2
  exit 1
fi

ssh "$HOST" "rm -rf $REMOTE_TMP && mkdir -p $REMOTE_TMP"
scp -q "$SOURCE" "$HOST:$REMOTE_TMP/SKILL.md"

# openclaw lives in ~/.npm-global/bin on the verification VM; export PATH so
# it's reachable in a non-interactive ssh.
ssh "$HOST" 'export PATH="$HOME/.npm-global/bin:$PATH"; openclaw skills install '"$REMOTE_TMP"' --global --force --as mda-compat-openclaw'

# Clean up the temp upload dir — OpenClaw has already copied the file into
# its managed dir.
ssh "$HOST" "rm -rf $REMOTE_TMP"

echo
echo "next: ssh $HOST 'PATH=\$HOME/.npm-global/bin:\$PATH openclaw skills info mda-compat-openclaw --json'"
echo
echo "to remove: ./compat/openclaw/uninstall.sh"
