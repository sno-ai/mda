#!/usr/bin/env bash
set -euo pipefail

# Reproducible structural verification: MDA-compiled SKILL.md matches the
# envelope Claude Code consumes. No live install required.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
SOURCE="$ROOT/compat/claude-code/source.mda"
BUILD_DIR="$ROOT/compat/claude-code/build"
OUTPUT="$BUILD_DIR/SKILL.md"

echo "==> compile $SOURCE -> SKILL.md"
rm -f "$OUTPUT"
node "$CLI" compile "$SOURCE" --target SKILL.md --out-dir "$BUILD_DIR" --integrity --quiet --no-next

echo "==> validate against SKILL.md JSON Schema"
node "$CLI" validate "$OUTPUT" --target SKILL.md --quiet --no-next

echo "==> envelope check (agentskills.io v1 subset Claude Code consumes)"
python3 - "$OUTPUT" <<'PY'
import sys, re, yaml
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
m = re.match(r'^---\n(.*?)\n---\n', text, re.DOTALL)
if not m:
    sys.exit("no frontmatter block found")
fm = yaml.safe_load(m.group(1))
# Recommended (per Claude Code docs): description. Required: none.
# We assert name + description present because MDA's own schema requires them.
for key in ("name", "description"):
    if not isinstance(fm.get(key), str) or not fm[key].strip():
        sys.exit(f"{key} missing or not a non-empty string")
# allowed-tools when present must be top-level, not nested under metadata.*
if "allowed-tools" in fm:
    if not isinstance(fm["allowed-tools"], str):
        sys.exit("allowed-tools must be a string at top level")
    print(f"   allowed-tools = {fm['allowed-tools']} (top-level: Claude Code will honor)")
print(f"   name = {fm['name']}")
print(f"   description = {fm['description'][:80]}...")
PY

echo "==> envelope check passed"
echo
echo "MDA-emitted SKILL.md passes the agentskills.io v1 envelope subset Claude"
echo "Code consumes today. Runtime-specific fields outside that subset"
echo "(when_to_use, model, effort, context, hooks, paths, ...) are out of MDA"
echo "v1.0 scope; see compat/claude-code/notes.md."
