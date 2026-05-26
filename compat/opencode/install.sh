#!/usr/bin/env bash
set -euo pipefail

# Live install: drops the MDA-compiled SKILL.md into ~/.config/opencode/skills/
# so an OpenCode session can discover it. ~/.config/opencode/skills/ is the
# user-level discovery path documented at opencode.ai/docs/skills/.
# OpenCode also walks ~/.claude/skills/ and ~/.agents/skills/ at user-level,
# but this kit defaults to OpenCode's own canonical path.
#
# Idempotent. Use with uninstall.sh.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/compat/opencode/build/SKILL.md"
TARGET_DIR="$HOME/.config/opencode/skills/mda-compat-opencode"
TARGET="$TARGET_DIR/SKILL.md"

if [ ! -f "$SOURCE" ]; then
  echo "build/SKILL.md missing — run ./verify.sh first" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cp "$SOURCE" "$TARGET"

echo "installed: $TARGET"
echo
echo "next: run \`opencode debug skill\` and confirm 'mda-compat-opencode'"
echo "appears in the listed skills."
echo
echo "to remove: ./compat/opencode/uninstall.sh"
