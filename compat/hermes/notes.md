# Verification notes — Hermes Agent

## Test setup

- **Date:** 2026-05-26
- **CLI:** `@markdown-ai/cli@1.1.7` (built from `apps/cli/`)
- **Hermes Agent:** `v0.9.0 (2026.4.13)` on `hermes-vm` (dedicated VM)
- **Source:** `compat/hermes/source.mda`
- **Compile command:** `mda compile compat/hermes/source.mda --target SKILL.md --out-dir compat/hermes/build --integrity`
- **Hermes discovery paths:**
  - User-level (per source): `~/.hermes/skills/<category>/<name>/SKILL.md`
  - Plus any paths in `~/.hermes/config.yaml` under `skills.external_dirs`

## What `verify.sh` confirms

1. `mda compile` produces a single `SKILL.md` from the source.
2. The output passes `mda validate --target SKILL.md` against `schemas/frontmatter-skill-md.schema.json`.
3. `name` and `description` are non-empty strings at the top level.
4. The `metadata.hermes.*` reserved namespace survives as a passthrough object.

`verify.sh` runs entirely from repo files. It does not touch the VM.

## What `install.sh` confirms

The compiled file is scp'd to `hermes-vm:~/.hermes/skills/compat/mda-compat-hermes/SKILL.md`. Hermes' next scan picks it up via the category-organized discovery layout. Directory name and frontmatter `name` agree (both `mda-compat-hermes`), satisfying spec §06-2.1.

## Empirical confirmation (2026-05-26)

`hermes skills list --source local` on `hermes-vm` returned:

```
                Installed Skills
┏━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━┳━━━━━━━┓
┃ Name              ┃ Category ┃ Source ┃ Trust ┃
┡━━━━━━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━╇━━━━━━━┩
│ mda-compat-hermes │ compat   │ local  │ local │
└───────────────────┴──────────┴────────┴───────┘
0 hub-installed, 74 builtin, 1 local
```

**Why this proves parse.** The list/scan code path in `~/.hermes/hermes-agent/agent/skill_commands.py` calls `parse_frontmatter(content)` at lines 102 and 226 before filtering. `parse_frontmatter()` lives in `~/.hermes/hermes-agent/agent/skill_utils.py:52` and runs PyYAML's `CSafeLoader` on the YAML block. A SKILL.md that failed to parse would be excluded from the listing. Our skill appears, so its frontmatter parsed.

This is primary-source evidence stronger than the Codex CLI description-recital check, because we read the parser code path directly rather than infer it from output shape.

## Known v1.0 spec gaps for Hermes authoring

Hermes skills routinely use `version` and `author` as top-level frontmatter fields (e.g. the shipped `~/.hermes/skills/autonomous-ai-agents/codex/SKILL.md` puts both at top level). MDA v1.0 nests `version` and `author` under `metadata.mda.*` and `unevaluatedProperties: false` rejects them at top level.

| Field | Hermes shape (observed) | MDA v1.0 status | Workaround |
| --- | --- | --- | --- |
| `version` | top-level string | Rejected at top level (must be `metadata.mda.version`) | Hand-edit post-compile or wait for v1.1 |
| `author` | top-level string | Rejected at top level (must be `metadata.mda.author`) | Hand-edit post-compile or wait for v1.1 |

Hermes consumes `metadata.hermes.{tags, related_skills, …}` via the reserved vendor namespace; that side works under MDA today.

The same v1.1 graduation criterion in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10 covers this gap.

## Caveats

- Hermes' loader is code-driven (not just documentation-driven). Re-verify by reading `~/.hermes/hermes-agent/agent/skill_utils.py` and `skill_commands.py` if the Hermes version bumps.
- `hermes skills inspect <name>` works on registry-resolved skills, not locally-dropped ones — that's why this kit uses `hermes skills list --source local` for empirical proof.
- This kit is for the SKILL.md target only. Hermes also reads AGENTS.md as project instructions; that surface belongs in a sibling AGENTS.md compat kit.
- The verification VM has Hermes Agent pre-installed. Re-running the empirical check requires the VM to be reachable as `hermes-vm` (override with `HERMES_HOST=...`).

## Out of this kit's scope

- Whether Hermes Agent parses MDA-extended frontmatter (`metadata.mda.*`). The loader stores the parsed dict whole; whether Hermes uses any field under `metadata.mda.*` is undocumented.
- Whether Hermes verifies `integrity.digest` or `signatures[]` at load. It does not, and no runtime does today.
- Whether `hermes chat --skills mda-compat-hermes "ping"` actually loads our skill body into the system prompt. That requires an API key and is out of scope for offline structural verification.
- Whether Hermes' loader changes in a way that breaks the envelope claim. We catch that on the next quarterly re-verify.
