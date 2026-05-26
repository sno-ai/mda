# Verification notes — Claude Code

## Test setup

- **Date:** 2026-05-26
- **CLI:** `@markdown-ai/cli@1.1.3` (built from `apps/cli/`)
- **Source:** `compat/claude-code/source.mda`
- **Compile command:** `mda compile compat/claude-code/source.mda --target SKILL.md --out-dir compat/claude-code/build --integrity`
- **Claude Code loader doc:** https://code.claude.com/docs/en/skills
- **Claude Code skill paths:** `~/.claude/skills/<name>/SKILL.md` (user) and `.claude/skills/<name>/SKILL.md` (project)

## What `verify.sh` confirms

1. `mda compile` produces a single `SKILL.md` from the source.
2. The output passes `mda validate --target SKILL.md` against `schemas/frontmatter-skill-md.schema.json`.
3. `name` and `description` are non-empty strings at the top level.
4. When `allowed-tools` is present, it is a string at the top level — the position Claude Code reads it from.

`verify.sh` runs entirely from repo files. It does not touch `~/.claude/skills/`.

## What `install.sh` confirms

The compiled file is copied to `~/.claude/skills/mda-compat-intro/SKILL.md`. A fresh Claude Code session loads it as a user-invocable skill, visible at session start. Directory name and frontmatter `name` agree (both `mda-compat-intro`), satisfying spec §06-2.1.

## Known v1.0 spec gaps for Claude Code authoring

Claude Code documents 15 top-level frontmatter fields. MDA v1.0's SKILL.md schema permits 8 (six agentskills.io v1 fields plus MDA's `integrity` and `signatures`). The remaining 11 are runtime-specific to Claude Code and **cannot be authored in MDA v1.0** — the validator rejects them.

| Field | Claude Code semantics | MDA v1.0 status | Workaround |
| --- | --- | --- | --- |
| `when_to_use` | Trigger hints for the model | Rejected | Hand-edit post-compile |
| `argument-hint` | Argument hint string | Rejected | Hand-edit post-compile |
| `arguments` | Structured arguments | Rejected | Hand-edit post-compile |
| `disable-model-invocation` | Disables auto-invocation by the model | Rejected | Hand-edit post-compile |
| `user-invocable` | Toggles `/skill-name` user invocation | Rejected | Hand-edit post-compile |
| `model` | Model override for the skill | Rejected | Hand-edit post-compile |
| `effort` | Effort/reasoning level | Rejected | Hand-edit post-compile |
| `context` | Context isolation mode (`fork`, etc.) | Rejected | Hand-edit post-compile |
| `agent` | Sub-agent declaration | Rejected | Hand-edit post-compile |
| `hooks` | Lifecycle hooks | Rejected | Hand-edit post-compile |
| `paths` | Path scoping | Rejected | Hand-edit post-compile |
| `shell` | Shell preference | Rejected | Hand-edit post-compile |

The hand-edit workaround keeps the door open, but it breaks the "one source compiles to many targets" wedge for any skill that needs those features. The fix is a schema extension in v1.1.

## Graduation criterion (v1.1 candidate)

This gap moves off the v1.0 "does-not-ship" list when:

- The SKILL.md schema is extended to accept the 11 Claude-Code-specific top-level fields (passthrough; MDA does not impose semantics on runtime-specific fields).
- Spec §06-3.2 enumerates them and §06-3.3 narrows the forbidden list accordingly.
- An MDA source can carry those fields (likely under a `claude-code` or vendor key in the source) and the compiler relocates them to top-level in the SKILL.md output.
- The same pattern is applied to AGENTS.md, MCP-SERVER.md, and CLAUDE.md targets where their runtimes accept additional top-level fields beyond AAIF defaults.

Tracked in `docs/v1.0/what-v1.0-does-not-ship.md`.

## Caveats

- Claude Code's loader is documentation-driven and subject to change. Re-run `verify.sh` quarterly and bump the verification date. If Claude Code's docs add a new top-level field, both the spec and this gap table need updating.
- `~/.claude/skills/ts-coder/SKILL.md` and similar shipped Anthropic skills use only the agentskills.io v1 envelope subset, so the envelope-level claim is exercised by Anthropic themselves. Other shipped skills (e.g., `codex-coder/SKILL.md` with `context: fork`) demonstrate the gap above in production.
- This kit is for SKILL.md only. Codex CLI (AGENTS.md) and OpenCode (SKILL.md, separate verification) live in sibling `compat/` directories.
- One observed field-name divergence in the wild: at least one official plugin skill uses `tools:` instead of `allowed-tools:`. The Claude Code docs name `allowed-tools`. Treat `tools:` as either deprecated alias or doc drift; do not mirror it from MDA until upstream clarifies.

## Out of this kit's scope

- Whether Claude Code parses MDA-extended frontmatter (`metadata.mda.*`). It does not, and the spec does not require it to.
- Whether Claude Code verifies `integrity.digest` or `signatures[]` at load. It does not, and no runtime does today.
- Whether Claude Code's loader changes in a way that breaks the envelope claim. We catch that on the next quarterly re-verify.
