#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$HOME/.claude/skills/mda-compat-intro"

if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "removed: $TARGET_DIR"
else
  echo "nothing to remove at $TARGET_DIR"
fi
