#!/usr/bin/env bash
set -euo pipefail

# Live install: drops the MDA-compiled SKILL.md into ~/.claude/skills/ so a
# fresh Claude Code session can load it. Idempotent. Use with uninstall.sh.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/compat/claude-code/build/SKILL.md"
TARGET_DIR="$HOME/.claude/skills/mda-compat-intro"
TARGET="$TARGET_DIR/SKILL.md"

if [ ! -f "$SOURCE" ]; then
  echo "build/SKILL.md missing — run ./verify.sh first" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET"

echo "installed: $TARGET"
echo
echo "next: start a new Claude Code session and confirm 'mda-compat-intro'"
echo "appears in the user-invocable skills list at session start."
echo
echo "to remove: ./compat/claude-code/uninstall.sh"
