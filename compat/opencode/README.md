# Compatibility: OpenCode (SKILL.md)

**Claim (Tier B, narrow).** An MDA-compiled `SKILL.md` whose frontmatter stays inside the field surface OpenCode documents at https://opencode.ai/docs/skills/ is discovered and parsed by OpenCode when installed at `~/.config/opencode/skills/<name>/SKILL.md`. `name`, `description`, body, plus the documented optional fields (`license`, `compatibility`, `metadata`) survive the round-trip from `.mda` source to runtime ingest.

**Claim (negative).** OpenCode's public docs enumerate exactly five top-level frontmatter fields (`name`, `description`, `license`, `compatibility`, `metadata`) and explicitly state "unknown frontmatter fields are ignored". MDA may emit `allowed-tools` (an agentskills.io v1 envelope field), and `integrity`/`signatures` (MDA additions), but OpenCode's documented behavior treats anything outside the five-field surface as ignored. This kit does not claim OpenCode honors `allowed-tools`, `integrity`, or `signatures` at load.

**Last verified:** 2026-05-26 against `@markdown-ai/cli@1.1.7`, OpenCode `1.15.10`.

## Directory contents

- `source.mda` — dedicated MDA source for this kit (do not reuse for unrelated examples)
- `build/SKILL.md` — reproducible compile output
- `verify.sh` — structural verification, no live install needed
- `install.sh` — optional live install to `~/.config/opencode/skills/mda-compat-opencode/SKILL.md`
- `uninstall.sh` — removes the live install
- `notes.md` — scope, gaps, caveats, graduation criteria

## Quick verify (offline, modifies nothing on your system)

```sh
./compat/opencode/verify.sh
```

Re-compiles `source.mda`, validates the output against the SKILL.md JSON Schema, and confirms the documented field surface is intact. Exit 0 means the structural claim holds.

## Live verify (writes one file under `~/.config/opencode/`)

```sh
./compat/opencode/install.sh
opencode debug skill | grep -A 5 mda-compat-opencode
```

Copies `build/SKILL.md` to `~/.config/opencode/skills/mda-compat-opencode/SKILL.md`. `opencode debug skill` enumerates discovered skills with parsed frontmatter — confirms both discovery and parse without invoking a model.

To remove:

```sh
./compat/opencode/uninstall.sh
```

## How OpenCode's loader actually behaves

From the official OpenCode skills documentation (https://opencode.ai/docs/skills/):

- Documented top-level frontmatter fields: `name` (req), `description` (req), `license`, `compatibility`, `metadata`.
- Unknown frontmatter fields are documented as ignored.
- `name` constraints: 1-64 chars, regex `^[a-z0-9]+(-[a-z0-9]+)*$`, no leading/trailing hyphen, no consecutive hyphens. The `name` field MUST match the directory name. (These constraints are identical to MDA spec §06-2.1.)
- Discovery (in order, project-local first, then global):
  - Project: `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` (walked from cwd up to repo root)
  - Global: `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`
- The docs make no mention of agentskills.io v1 as an upstream contract.

## What MDA emits today (v1.0)

The SKILL.md schema (`schemas/frontmatter-skill-md.schema.json`) permits these top-level fields, exactly:

| Field | Source | OpenCode status |
| --- | --- | --- |
| `name` | author | Documented, required. |
| `description` | author | Documented, required. |
| `license` | author | Documented, optional. |
| `compatibility` | author | Documented, optional. |
| `allowed-tools` | author | Not in OpenCode's documented surface; "unknown fields are ignored". |
| `metadata` | author | Documented, optional. `metadata.mda.*` for MDA extensions; OpenCode does not document reading any nested namespace. |
| `integrity` | compiler | Not in OpenCode's documented surface; ignored. |
| `signatures` | compiler/signer | Not in OpenCode's documented surface; ignored. |

Everything in MDA's source schema that lives inside the OpenCode-documented surface survives the round-trip. Everything else passes through harmlessly because OpenCode ignores unknown fields.

## What this kit does NOT claim

- That OpenCode parses MDA-extended frontmatter (`metadata.mda.*`, `metadata.opencode.*`, etc.).
- That signed MDA artifacts are verified at load time by OpenCode.
- That `~/.config/opencode/skills/<name>/SKILL.md` is the only path OpenCode reads. OpenCode also walks `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` (project-local) and `~/.claude/skills/`, `~/.agents/skills/` (global). This kit defaults to OpenCode's own canonical user-level path.
- That `allowed-tools` is honored. The kit deliberately omits it from `source.mda` to mirror OpenCode's documented surface exactly.

Anything stronger belongs in a future Tier-C section, behind explicit runtime opt-in to MDA extensions.
