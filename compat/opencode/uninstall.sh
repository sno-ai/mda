#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="$HOME/.config/opencode/skills/mda-compat-opencode"

if [ -d "$TARGET_DIR" ]; then
  rm -rf "$TARGET_DIR"
  echo "removed: $TARGET_DIR"
else
  echo "nothing to remove at $TARGET_DIR"
fi
