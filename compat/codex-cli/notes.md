# Verification notes — Codex CLI

## Test setup

- **Date:** 2026-05-26
- **CLI:** `@markdown-ai/cli@1.1.3` (built from `apps/cli/`)
- **Codex CLI:** `codex-cli 0.133.0` (npm `@openai/codex`)
- **Source:** `compat/codex-cli/source.mda`
- **Compile command:** `mda compile compat/codex-cli/source.mda --target SKILL.md --out-dir compat/codex-cli/build --integrity`
- **Codex CLI skills doc:** https://developers.openai.com/codex/skills
- **Codex CLI discovery paths (per docs):**
  - Project-local: `.agents/skills/` (walked from cwd up to repo root)
  - User-level: `~/.agents/skills/`
  - Admin-level: `/etc/codex/skills/`
  - Plus bundled skills

## What `verify.sh` confirms

1. `mda compile` produces a single `SKILL.md` from the source.
2. The output passes `mda validate --target SKILL.md` against `schemas/frontmatter-skill-md.schema.json`.
3. `name` and `description` are non-empty strings at the top level (the two fields Codex CLI's public docs document).
4. When `allowed-tools` is present, it is a string at the top level — its agentskills.io v1 envelope position.

`verify.sh` runs entirely from repo files. It does not touch `~/.agents/skills/`.

## What `install.sh` confirms

The compiled file is copied to `~/.agents/skills/mda-compat-codex-cli/SKILL.md`. A Codex CLI session discovers the skill via the documented user-level path. Directory name and frontmatter `name` agree (both `mda-compat-codex-cli`), satisfying spec §06-2.1.

## Empirical confirmation (2026-05-26)

After `install.sh`, two `codex exec` runs on Codex CLI `0.133.0` confirmed the kit:

1. **Discovery.** Enumerating available skills returned `mda-compat-codex-cli` alongside the existing user skills and bundled OpenAI/Vercel/Google packages.
2. **Parse.** Asking Codex CLI to recite the `description` field verbatim returned the full description string from the MDA-emitted frontmatter, confirming the YAML block parsed (not just the directory name being listed). The agent also surfaced the full frontmatter block including `metadata.mda.*` and `integrity` blobs as part of skill content access.

Both checks used `--sandbox read-only --skip-git-repo-check` and required no Codex CLI configuration changes beyond the file copy.

## Discovery-path observation

In addition to the documented `~/.agents/skills/`, Codex CLI is observed to also discover skills under `~/.codex/skills/` on this machine. That path is not enumerated in the public skills documentation; treat it as observed behavior rather than a documented contract. The kit defaults to the documented path. Users who already organize their skills under `~/.codex/skills/` can edit `install.sh`.

## Known v1.0 spec gaps for Codex CLI authoring

The public Codex CLI skills documentation enumerates `name` and `description` at the top level and treats agentskills.io v1 as the upstream contract. Beyond that, the doc does not list runtime-specific top-level fields the way Claude Code does. So the v1.0 envelope subset matches the documented surface for Codex CLI.

One non-standard field has been observed in the wild:

| Field | Origin | MDA v1.0 status | Notes |
| --- | --- | --- | --- |
| `triggers` (array) | Not part of agentskills.io v1; appears in at least one shipped Codex skill on this machine | Rejected | Source unknown — could be doc drift, a private convention, or a feature outside the public skills page. Do not author from MDA until upstream clarifies. |

If Codex CLI adopts further runtime-specific top-level fields publicly, they fall under the same v1.1 graduation criterion as the Claude-Code-specific fields in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10.

## Graduation criterion (v1.1 candidate, shared)

This gap moves off the v1.0 "does-not-ship" list when:

- The SKILL.md schema is extended to accept publicly-documented runtime-specific top-level fields as passthrough (MDA does not impose semantics on runtime-owned fields).
- Spec §06-3.2 enumerates them and §06-3.3 narrows the forbidden list accordingly.
- An MDA source can carry those fields (likely under a vendor key in the source) and the compiler relocates them to top-level in the SKILL.md output.

Same criterion as Claude Code; the gap is symmetric across Tier-1 SKILL.md consumers. Tracked in `docs/v1.0/what-v1.0-does-not-ship.md`.

## Caveats

- Codex CLI's loader behavior is documentation-driven and subject to change. Re-run `verify.sh` quarterly and bump the verification date. If the public skills docs add new top-level fields, both the spec and this gap table need updating.
- Existing shipped Codex skills observed on this machine (`ts-coder`, `python-coder`, `pdf`, `playwright`, etc.) use only `name` + `description` — the envelope-level claim is exercised by skills shipped from OpenAI's own conventions.
- This kit is for the SKILL.md target only. Codex CLI also reads AGENTS.md as project instructions; that surface belongs in a sibling AGENTS.md compat kit, not here.

## Out of this kit's scope

- Whether Codex CLI parses MDA-extended frontmatter (`metadata.mda.*`). The public docs do not document this, and the spec does not require it.
- Whether Codex CLI verifies `integrity.digest` or `signatures[]` at load. It does not, and no runtime does today.
- Whether project-local discovery walks via `.agents/skills/` are exercised. They follow the same envelope rules; the user-level install in this kit is sufficient to demonstrate the claim.
- Whether Codex CLI's loader changes in a way that breaks the envelope claim. We catch that on the next quarterly re-verify.
