#!/usr/bin/env bash
set -euo pipefail

# Reproducible structural verification: MDA-compiled SKILL.md matches the
# envelope Codex CLI consumes. No live install required.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
SOURCE="$ROOT/compat/codex-cli/source.mda"
BUILD_DIR="$ROOT/compat/codex-cli/build"
OUTPUT="$BUILD_DIR/SKILL.md"

echo "==> compile $SOURCE -> SKILL.md"
rm -f "$OUTPUT"
node "$CLI" compile "$SOURCE" --target SKILL.md --out-dir "$BUILD_DIR" --integrity --quiet --no-next

echo "==> validate against SKILL.md JSON Schema"
node "$CLI" validate "$OUTPUT" --target SKILL.md --quiet --no-next

echo "==> envelope check (agentskills.io v1 subset Codex CLI consumes)"
python3 - "$OUTPUT" <<'PY'
import sys, re, yaml
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
m = re.match(r'^---\n(.*?)\n---\n', text, re.DOTALL)
if not m:
    sys.exit("no frontmatter block found")
fm = yaml.safe_load(m.group(1))
# Codex CLI docs document `name` + `description` as the top-level fields.
# We assert both are non-empty strings (MDA itself requires this too).
for key in ("name", "description"):
    if not isinstance(fm.get(key), str) or not fm[key].strip():
        sys.exit(f"{key} missing or not a non-empty string")
# allowed-tools is an agentskills.io v1 field. Codex CLI inherits parser
# tolerance for it; assert it lives at top level when present.
if "allowed-tools" in fm:
    if not isinstance(fm["allowed-tools"], str):
        sys.exit("allowed-tools must be a string at top level")
    print(f"   allowed-tools = {fm['allowed-tools']} (top-level, agentskills.io v1 envelope)")
print(f"   name = {fm['name']}")
print(f"   description = {fm['description'][:80]}...")
PY

echo "==> envelope check passed"
echo
echo "MDA-emitted SKILL.md passes the agentskills.io v1 envelope subset Codex"
echo "CLI documents. Runtime-specific extensions beyond that subset are out"
echo "of MDA v1.0 scope; see compat/codex-cli/notes.md."
