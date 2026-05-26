#!/usr/bin/env bash
set -euo pipefail

# Reproducible structural verification: MDA-compiled SKILL.md matches the
# envelope OpenCode consumes per opencode.ai/docs/skills/. No live install
# required.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
SOURCE="$ROOT/compat/opencode/source.mda"
BUILD_DIR="$ROOT/compat/opencode/build"
OUTPUT="$BUILD_DIR/SKILL.md"

echo "==> compile $SOURCE -> SKILL.md"
rm -f "$OUTPUT"
node "$CLI" compile "$SOURCE" --target SKILL.md --out-dir "$BUILD_DIR" --integrity --quiet --no-next

echo "==> validate against SKILL.md JSON Schema"
node "$CLI" validate "$OUTPUT" --target SKILL.md --quiet --no-next

echo "==> envelope check (fields OpenCode docs document)"
python3 - "$OUTPUT" <<'PY'
import sys, re, yaml
path = sys.argv[1]
text = open(path, encoding='utf-8').read()
m = re.match(r'^---\n(.*?)\n---\n', text, re.DOTALL)
if not m:
    sys.exit("no frontmatter block found")
fm = yaml.safe_load(m.group(1))
# OpenCode docs document: name (req), description (req), license, compatibility, metadata.
# Unknown fields are documented as ignored.
for key in ("name", "description"):
    if not isinstance(fm.get(key), str) or not fm[key].strip():
        sys.exit(f"{key} missing or not a non-empty string")
# name regex check per OpenCode + spec §06-2.1
import re as _re
if not _re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", fm["name"]):
    sys.exit(f"name {fm['name']!r} fails OpenCode regex")
if len(fm["name"]) > 64:
    sys.exit(f"name {fm['name']!r} exceeds 64 chars")
print(f"   name = {fm['name']} (regex + length ok)")
print(f"   description = {fm['description'][:80]}...")
for opt in ("license", "compatibility"):
    if opt in fm:
        print(f"   {opt} = {fm[opt]} (documented optional)")
if "metadata" in fm:
    print(f"   metadata.* present (documented optional, free-form map)")
PY

echo "==> envelope check passed"
echo
echo "MDA-emitted SKILL.md passes the field surface OpenCode documents at"
echo "opencode.ai/docs/skills/. Unknown fields (e.g. allowed-tools) are"
echo "documented as ignored by OpenCode; see compat/opencode/notes.md."
