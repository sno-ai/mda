# Verification notes — OpenCode

## Test setup

- **Date:** 2026-05-26
- **CLI:** `@markdown-ai/cli@1.1.7` (built from `apps/cli/`)
- **OpenCode:** `1.15.10` (npm `opencode-ai`, installed for verification then uninstalled per session policy)
- **Source:** `compat/opencode/source.mda`
- **Compile command:** `mda compile compat/opencode/source.mda --target SKILL.md --out-dir compat/opencode/build --integrity`
- **OpenCode skills doc:** https://opencode.ai/docs/skills/
- **OpenCode discovery paths (per docs):**
  - Project-local: `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` (walked cwd up to repo root)
  - User-level: `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`

## What `verify.sh` confirms

1. `mda compile` produces a single `SKILL.md` from the source.
2. The output passes `mda validate --target SKILL.md` against `schemas/frontmatter-skill-md.schema.json`.
3. `name` and `description` are non-empty strings at the top level.
4. `name` passes the OpenCode regex (`^[a-z0-9]+(-[a-z0-9]+)*$`) and ≤64 chars.
5. Documented optional fields (`license`, `compatibility`, `metadata`) survive when present.

`verify.sh` runs entirely from repo files. It does not touch `~/.config/opencode/`.

## What `install.sh` confirms

The compiled file is copied to `~/.config/opencode/skills/mda-compat-opencode/SKILL.md`. An OpenCode session discovers the skill via the documented user-level path. Directory name and frontmatter `name` agree (both `mda-compat-opencode`), satisfying OpenCode's `name`-equals-dir rule and spec §06-2.1.

## Empirical confirmation (2026-05-26)

After `install.sh`, `opencode debug skill` on OpenCode `1.15.10` enumerated the discovered skills as JSON. The output for `mda-compat-opencode` returned:

- `"name"`: matches the source `name` field
- `"description"`: returns the full MDA-emitted description string verbatim
- `"location"`: reports the install path under `~/.config/opencode/skills/`
- `"content"`: returns the full Markdown body verbatim

This is a stronger empirical signal than a discovery-only check: a directory listing alone would not return the description and body. The fact that OpenCode's debug command produces structured frontmatter and body content proves the loader actually parsed the YAML block.

## Known v1.0 spec gaps for OpenCode authoring

OpenCode documents five top-level fields. MDA v1.0's SKILL.md schema covers all five (`name`, `description`, `license`, `compatibility`, `metadata`) plus `allowed-tools` (agentskills.io v1) and `integrity`/`signatures` (MDA additions). OpenCode's documented behavior is "unknown frontmatter fields are ignored", so the extra fields MDA may emit pass through harmlessly — they are not rejected, but they are not honored either.

No runtime-specific OpenCode top-level fields are documented beyond the five enumerated above. So unlike Claude Code (which documents 11 extras), there is no symmetric authoring gap. If OpenCode adds runtime-specific top-level fields publicly later, they fall under the same v1.1 graduation criterion as the Claude-Code-specific fields in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10.

## Caveats

- OpenCode's loader behavior is documentation-driven and subject to change. Re-run `verify.sh` quarterly and bump the verification date. If the public skills docs add new top-level fields, both the spec and this gap table need updating.
- OpenCode's "unknown fields are ignored" policy makes MDA's superset emit safe by default. This is a softer compatibility surface than Claude Code's `unevaluatedProperties: false` posture, and a notable contrast worth keeping in mind when comparing runtimes.
- This kit is for the SKILL.md target only. OpenCode also reads AGENTS.md as project instructions; that surface belongs in a sibling AGENTS.md compat kit, not here.
- OpenCode was installed only for this verification session (`npm install -g opencode-ai`, then `opencode uninstall` + `npm uninstall -g opencode-ai`). Re-verifying requires reinstalling.

## Out of this kit's scope

- Whether OpenCode parses MDA-extended frontmatter (`metadata.mda.*`). The public docs do not document this.
- Whether OpenCode verifies `integrity.digest` or `signatures[]` at load. It does not, and no runtime does today.
- Whether `allowed-tools` is honored by OpenCode in any way. The kit deliberately omits it from `source.mda` to mirror the documented surface exactly.
- Whether project-local discovery walks (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`) are exercised. They follow the same envelope rules; the user-level install in this kit is sufficient to demonstrate the claim.
- Whether OpenCode's loader changes in a way that breaks the documented-surface claim. We catch that on the next quarterly re-verify.
