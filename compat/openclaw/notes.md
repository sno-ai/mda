# Verification notes — OpenClaw

## Test setup

- **Date:** 2026-05-26
- **CLI:** `@markdown-ai/cli@1.1.7` (built from `apps/cli/`)
- **OpenClaw:** `2026.5.20 (e510042)` on `openclaw-vm` (dedicated VM, installed via npm at `~/.npm-global/bin/openclaw`)
- **Source:** `compat/openclaw/source.mda`
- **Compile command:** `mda compile compat/openclaw/source.mda --target SKILL.md --out-dir compat/openclaw/build --integrity`
- **OpenClaw skills doc:** https://docs.openclaw.ai/cli/skills
- **OpenClaw discovery paths (observed):**
  - Managed global: `~/.openclaw/skills/<slug>/SKILL.md` (where `openclaw skills install --global` lands)
  - Bundled extras: `~/.openclaw/plugin-skills/<name>/SKILL.md`
  - Per-agent: `~/.openclaw/agents/<agent>/.../skills/` (under each agent workspace)

## What `verify.sh` confirms

1. `mda compile` produces a single `SKILL.md` from the source.
2. The output passes `mda validate --target SKILL.md` against `schemas/frontmatter-skill-md.schema.json`.
3. `name` and `description` are non-empty strings at the top level.

`verify.sh` runs entirely from repo files. It does not touch the VM.

## What `install.sh` confirms

The compiled `SKILL.md` is scp'd to a temp dir on `openclaw-vm`, then `openclaw skills install <tmp-dir> --global --force --as mda-compat-openclaw` copies it into `~/.openclaw/skills/mda-compat-openclaw/SKILL.md`. OpenClaw treats the result as a managed global skill (`source: openclaw-managed`).

## Empirical confirmation (2026-05-26)

`openclaw skills info mda-compat-openclaw --json` on `openclaw-vm` returned the parsed skill record:

```json
{
  "name": "mda-compat-openclaw",
  "description": "MDA compatibility demonstration skill for OpenClaw. Compiled from compat/openclaw/source.mda. Loading this skill confirms ...",
  "source": "openclaw-managed",
  "bundled": false,
  "filePath": "/home/lh/.openclaw/skills/mda-compat-openclaw/SKILL.md",
  "baseDir": "/home/lh/.openclaw/skills/mda-compat-openclaw",
  "skillKey": "mda-compat-openclaw",
  "eligible": true,
  "modelVisible": true,
  "userInvocable": true,
  "commandVisible": true,
  "requirements": {"bins": [], "anyBins": [], "env": [], "config": [], "os": []},
  "missing": {"bins": [], "anyBins": [], "env": [], "config": [], "os": []}
}
```

This is the strongest empirical signal across all five runtime kits: OpenClaw returns the full parsed `name`, `description`, resolved `filePath`, and the complete eligibility / visibility decision it computed from our frontmatter. The skill is `eligible: true` and `modelVisible: true` — OpenClaw would surface it to the model if invoked in a session.

## Known v1.0 spec gaps for OpenClaw authoring

OpenClaw's existing shipped skills (e.g. `~/.openclaw/plugin-skills/browser-automation/SKILL.md`) carry `user-invocable: <bool>` at the top level — the same Claude-Code-extended field MDA v1.0 rejects.

| Field | OpenClaw shape (observed) | MDA v1.0 status | Workaround |
| --- | --- | --- | --- |
| `user-invocable` | top-level boolean | Rejected at top level | Hand-edit post-install or wait for v1.1 |

Other Claude-Code-extended fields likely apply by the same pattern when OpenClaw skills use them. The same v1.1 graduation criterion in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10 covers this gap.

## Caveats

- OpenClaw is shipped under the `~/.npm-global/bin/` path on the verification VM; the install scripts export `PATH` accordingly. If your VM uses a different npm prefix, edit `install.sh`/`uninstall.sh`.
- `openclaw skills` has no `uninstall` subcommand; `uninstall.sh` removes the managed dir directly via `rm -rf`.
- This kit is for the SKILL.md target only. OpenClaw also reads AGENTS.md as project instructions; that surface belongs in a sibling AGENTS.md compat kit.
- The verification VM has OpenClaw pre-installed. Re-running the empirical check requires the VM to be reachable as `openclaw-vm` (override with `OPENCLAW_HOST=...`).

## Out of this kit's scope

- Whether OpenClaw parses MDA-extended frontmatter (`metadata.mda.*`). The `info --json` output does not surface nested `metadata.*` namespaces.
- Whether OpenClaw verifies `integrity.digest` or `signatures[]` at load. It does not, and no runtime does today.
- Whether the per-agent skill install path (`--agent <id>` without `--global`) yields identical behavior. This kit uses `--global`.
- Whether OpenClaw's loader changes in a way that breaks the envelope claim. We catch that on the next quarterly re-verify.
