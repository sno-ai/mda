# Compatibility: Claude Code (SKILL.md)

**Claim (Tier B, narrow).** An MDA-compiled `SKILL.md` whose frontmatter stays inside the agentskills.io v1 envelope subset loads in Claude Code, with `name`, `description`, body, and top-level `allowed-tools` arriving where Claude Code's loader expects them.

**Claim (negative).** MDA v1.0 does not author the runtime-specific Claude Code top-level fields outside agentskills.io v1 (`when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`). That gap is documented in spec §06-3.4 and is earmarked for v1.1. See `notes.md`.

**Last verified:** 2026-05-26 against `@markdown-ai/cli@1.1.3`, Claude Code current.

## Directory contents

- `source.mda` — dedicated MDA source for this kit (do not reuse for unrelated examples)
- `build/SKILL.md` — reproducible compile output
- `verify.sh` — structural verification, no live install needed
- `install.sh` — optional live install to `~/.claude/skills/mda-compat-intro/SKILL.md`
- `uninstall.sh` — removes the live install
- `notes.md` — scope, gaps, caveats, graduation criteria

## Quick verify (offline, modifies nothing on your system)

```sh
./compat/claude-code/verify.sh
```

Re-compiles `source.mda`, validates the output against the SKILL.md JSON Schema, and confirms the envelope subset is intact. Exit 0 means the structural claim holds.

## Live verify (writes one file under `~/.claude/skills/`)

```sh
./compat/claude-code/install.sh
```

Copies `build/SKILL.md` to `~/.claude/skills/mda-compat-intro/SKILL.md`. Start a new Claude Code session. `mda-compat-intro` should appear in the user-invocable skills list at session start.

To remove:

```sh
./compat/claude-code/uninstall.sh
```

## How Claude Code's loader actually behaves

From the official Claude Code skills documentation (https://code.claude.com/docs/en/skills):

- All frontmatter fields are optional. `description` is recommended.
- `name` defaults to the directory name. When both are present, the directory name wins.
- 15 documented top-level fields are recognized: `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`.
- No nested `metadata.*` namespace is documented or honored.
- A skill lives at `<dir>/SKILL.md`; sibling `scripts/`, `references/`, `assets/` are loaded on demand.

## What MDA emits today (v1.0)

The SKILL.md schema (`schemas/frontmatter-skill-md.schema.json`) permits these top-level fields, exactly:

| Field | Source | Notes |
| --- | --- | --- |
| `name` | author | Required by MDA. Must equal directory name (spec §06-2.1). |
| `description` | author | Required by MDA. Recommended by Claude Code. |
| `license` | author | Optional. Plain agentskills.io v1. |
| `compatibility` | author | Optional. Plain agentskills.io v1. |
| `allowed-tools` | author | Optional. Plain agentskills.io v1 (experimental upstream). Claude Code honors it. |
| `metadata` | author | Optional. `metadata.mda.*` for MDA extensions, `metadata.<vendor>.*` reserved for vendor namespaces. Claude Code does not read this namespace today. |
| `integrity` | compiler | Optional. Content digest. Claude Code does not verify. |
| `signatures` | compiler/signer | Optional. DSSE envelope. Claude Code does not verify. |

Everything else is rejected by `unevaluatedProperties: false`.

## What MDA does NOT emit today

The other 11 Claude-Code-specific top-level fields. An author who needs `when_to_use`, `hooks`, `paths`, `model`, `effort`, `context`, `agent`, `argument-hint`, `arguments`, `disable-model-invocation`, or `user-invocable` cannot author them in MDA v1.0; the MDA validator will reject the source. Workaround: hand-edit the compiled `SKILL.md` post-compile.

This is a known gap. Tracked in `docs/v1.0/what-v1.0-does-not-ship.md` and earmarked for v1.1.

## What this kit does NOT claim

- That Claude Code parses MDA-extended frontmatter (`metadata.mda.*`, `metadata.claude-code.*`, etc.).
- That signed MDA artifacts are verified at load time by Claude Code.
- That an MDA-authored SKILL.md can use Claude Code's full feature surface today.
- That `~/.claude/skills/<name>/SKILL.md` is the only path Claude Code reads. Project-local `.claude/skills/<name>/SKILL.md` works the same way; this kit just defaults to user-global for convenience.

Anything stronger belongs in a future Tier-C section, behind explicit runtime opt-in to MDA extensions.
