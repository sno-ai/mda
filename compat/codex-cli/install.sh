#!/usr/bin/env bash
set -euo pipefail

# Live install: drops the MDA-compiled SKILL.md into ~/.agents/skills/ so a
# Codex CLI session can discover it. ~/.agents/skills/ is the user-level
# discovery path documented at https://developers.openai.com/codex/skills.
# Codex CLI also scans ~/.codex/skills/ in observed practice, but the
# documented canonical path is ~/.agents/skills/.
#
# Idempotent. Use with uninstall.sh.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/compat/codex-cli/build/SKILL.md"
TARGET_DIR="$HOME/.agents/skills/mda-compat-codex-cli"
TARGET="$TARGET_DIR/SKILL.md"

if [ ! -f "$SOURCE" ]; then
  echo "build/SKILL.md missing — run ./verify.sh first" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET"

echo "installed: $TARGET"
echo
echo "next: run a Codex CLI session (e.g. \`codex exec 'list available skills'\`)"
echo "and confirm 'mda-compat-codex-cli' is discovered."
echo
echo "to remove: ./compat/codex-cli/uninstall.sh"
