# Compatibility: Hermes Agent (SKILL.md)

**Claim (Tier B, narrow).** An MDA-compiled `SKILL.md` whose frontmatter stays inside the agentskills.io v1 envelope subset is discovered and parsed by Hermes Agent when installed under its category-organized layout at `~/.hermes/skills/<category>/<name>/SKILL.md`. `name`, `description`, body, and the reserved `metadata.hermes.*` vendor namespace survive the round-trip from `.mda` source to runtime ingest, and the skill enumerates in `hermes skills list --source local`.

**Claim (negative).** Some shipped Hermes skills carry `version` and `author` as top-level fields rather than under `metadata.mda.*`. MDA v1.0's SKILL.md schema rejects those at the top level (per §06-3.3 forbidden list). The same v1.1 schema-expansion gap that applies to Claude Code applies here.

**Last verified:** 2026-05-26 against `@markdown-ai/cli@1.1.7`, Hermes Agent `v0.9.0 (2026.4.13)` on `hermes-vm`.

## Directory contents

- `source.mda` — dedicated MDA source for this kit (do not reuse for unrelated examples)
- `build/SKILL.md` — reproducible compile output
- `verify.sh` — structural verification, no live install needed
- `install.sh` — optional live install via SSH to `hermes-vm:~/.hermes/skills/compat/mda-compat-hermes/SKILL.md` (override host with `HERMES_HOST=...`)
- `uninstall.sh` — removes the live install from the VM
- `notes.md` — scope, gaps, caveats, graduation criteria

## Quick verify (offline, modifies nothing on any system)

```sh
./compat/hermes/verify.sh
```

Re-compiles `source.mda`, validates the output against the SKILL.md JSON Schema, and confirms the envelope subset plus `metadata.hermes.*` passthrough are intact.

## Live verify (writes one file under `hermes-vm:~/.hermes/skills/compat/`)

```sh
./compat/hermes/install.sh
ssh hermes-vm 'hermes skills list --source local'
```

Copies `build/SKILL.md` over SSH to `hermes-vm`. `hermes skills list --source local` enumerates locally-installed skills — the source code path for this list invokes Hermes' `parse_frontmatter()` (`~/.hermes/hermes-agent/agent/skill_commands.py:102`, `:226`), so an entry in the list implies the frontmatter parsed.

To remove:

```sh
./compat/hermes/uninstall.sh
```

## How Hermes' loader actually behaves

From the Hermes Agent source on the verification VM (`~/.hermes/hermes-agent/agent/skill_utils.py:52`):

- Hermes parses frontmatter with PyYAML's `CSafeLoader`, supporting nested objects and lists.
- The list/scan code paths (`skill_commands.py:102`, `:226`) invoke `parse_frontmatter()` before filtering by platforms/disabled-list.
- Discovery is rooted at `~/.hermes/skills/<category>/<name>/SKILL.md` (category-organized) plus `external_dirs` configured in `~/.hermes/config.yaml`.
- `hermes skills install <identifier>` fetches from registries (skills.sh, ClawHub, GitHub taps, builtin); local files dropped into the discovery layout are picked up at scan time.
- Existing Hermes skills routinely add `metadata.hermes.{tags, related_skills}` for Hermes-specific filtering and graph references.

## What MDA emits today (v1.0)

The SKILL.md schema (`schemas/frontmatter-skill-md.schema.json`) permits these top-level fields, exactly:

| Field | Source | Hermes status |
| --- | --- | --- |
| `name` | author | Required; must match dir name (spec §06-2.1). |
| `description` | author | Required by MDA; consumed by Hermes for skill descriptions. |
| `license` | author | Optional. Hermes accepts at top level. |
| `compatibility` | author | Optional. Hermes accepts at top level. |
| `allowed-tools` | author | agentskills.io v1; Hermes loader behavior on this field is not documented. |
| `metadata` | author | Optional. `metadata.mda.*` MDA-extended, `metadata.hermes.*` reserved for Hermes and read by Hermes for tags/related-skills/etc. |
| `integrity` | compiler | Not consumed by Hermes today. |
| `signatures` | compiler/signer | Not consumed by Hermes today. |

## What MDA does NOT emit today

Some shipped Hermes skills declare `version` and `author` (and possibly other Hermes-extended fields) as top-level frontmatter — outside the agentskills.io v1 envelope. MDA v1.0's schema rejects those at the top level. Authors who need them either hand-edit the compiled output (exits MDA validation) or wait for v1.1. Tracked in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10, same graduation criterion as the Claude Code runtime fields.

## What this kit does NOT claim

- That Hermes Agent honors `allowed-tools`, `integrity`, or `signatures` at load.
- That signed MDA artifacts are verified at load time by Hermes.
- That every Hermes-specific top-level field (`version`, `author`, …) is authorable from MDA today.
- That `hermes skills install <local-path>` accepts arbitrary file paths. Local files are picked up by drop-into-discovery-layout, not by the `install` subcommand.

Anything stronger belongs in a future Tier-C section, behind explicit runtime opt-in to MDA extensions.
