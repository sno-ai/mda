# Compatibility: OpenClaw (SKILL.md)

**Claim (Tier B, narrow).** An MDA-compiled `SKILL.md` whose frontmatter stays inside the agentskills.io v1 envelope subset installs cleanly via `openclaw skills install <local-dir> --global` and is reported as parsed by `openclaw skills info <name> --json` — which returns the parsed `name`, `description`, resolved `filePath` under `~/.openclaw/skills/`, and the full eligibility decision OpenClaw computes from the skill's frontmatter.

**Claim (negative).** Some shipped OpenClaw skills carry `user-invocable` as a top-level field (e.g. `~/.openclaw/plugin-skills/browser-automation/SKILL.md`). MDA v1.0's SKILL.md schema rejects that at the top level. The same v1.1 schema-expansion gap covers it.

**Last verified:** 2026-05-26 against `@markdown-ai/cli@1.1.7`, OpenClaw `2026.5.20 (e510042)` on `openclaw-vm`.

## Directory contents

- `source.mda` — dedicated MDA source for this kit (do not reuse for unrelated examples)
- `build/SKILL.md` — reproducible compile output
- `verify.sh` — structural verification, no live install needed
- `install.sh` — optional live install via SSH; runs `openclaw skills install` on `openclaw-vm` (override host with `OPENCLAW_HOST=...`)
- `uninstall.sh` — removes the managed dir on the VM
- `notes.md` — scope, gaps, caveats, graduation criteria

## Quick verify (offline, modifies nothing on any system)

```sh
./compat/openclaw/verify.sh
```

Re-compiles `source.mda`, validates the output against the SKILL.md JSON Schema, and confirms the envelope subset is intact.

## Live verify (writes one file under `openclaw-vm:~/.openclaw/skills/`)

```sh
./compat/openclaw/install.sh
ssh openclaw-vm 'PATH=$HOME/.npm-global/bin:$PATH openclaw skills info mda-compat-openclaw --json'
```

`install.sh` scps the compiled `SKILL.md` to a temp dir on `openclaw-vm`, then runs `openclaw skills install <tmp-dir> --global --force --as mda-compat-openclaw`. OpenClaw copies the file into `~/.openclaw/skills/mda-compat-openclaw/SKILL.md`. `openclaw skills info` then prints the full parsed JSON view.

To remove:

```sh
./compat/openclaw/uninstall.sh
```

## How OpenClaw's loader actually behaves

From OpenClaw `2026.5.20` (`https://docs.openclaw.ai/cli/skills`):

- `openclaw skills install <slug>` accepts ClawHub slug, `git:<repo>`, OR a local directory containing `SKILL.md` at its root.
- `--global` installs to the shared managed skills directory (`~/.openclaw/skills/<slug>/`); without it, the install lands under a specific agent workspace via `--agent <id>`.
- `--as <slug>` overrides the inferred slug; without it, slug derives from directory name or frontmatter `name`.
- `openclaw skills info <name> --json` returns the parsed skill record: name, description, filePath, baseDir, skillKey, eligibility flags, requirement detection (bins, env, config, os), and visibility flags (modelVisible, userInvocable, commandVisible).
- Existing skills use the agentskills.io v1 envelope subset plus the Claude-Code-extended `user-invocable: <bool>` top-level field.

## What MDA emits today (v1.0)

The SKILL.md schema (`schemas/frontmatter-skill-md.schema.json`) permits these top-level fields, exactly:

| Field | Source | OpenClaw status |
| --- | --- | --- |
| `name` | author | Required; consumed by OpenClaw for the install slug and skill key. |
| `description` | author | Required by MDA; surfaced in OpenClaw's skills list and info output. |
| `license` | author | Optional. Plain agentskills.io v1. |
| `compatibility` | author | Optional. Plain agentskills.io v1. |
| `allowed-tools` | author | agentskills.io v1; OpenClaw documented behavior on this field is unspecified. |
| `metadata` | author | Optional. `metadata.mda.*` MDA-extended; OpenClaw does not document reading any nested namespace. |
| `integrity` | compiler | Not consumed by OpenClaw. |
| `signatures` | compiler/signer | Not consumed by OpenClaw. |

## What MDA does NOT emit today

OpenClaw shipped skills include `user-invocable: <bool>` at the top level (Claude-Code-extended). MDA v1.0 rejects that at the top level. Workaround: hand-edit the installed `SKILL.md` post-install (exits MDA validation). Tracked in `docs/v1.0/what-v1.0-does-not-ship.md` gap #10, same graduation criterion as the Claude Code runtime fields.

## What this kit does NOT claim

- That OpenClaw honors `allowed-tools`, `integrity`, or `signatures` at load.
- That signed MDA artifacts are verified at load time by OpenClaw.
- That the skill is loaded into a live agent session and surfaced to the model at runtime. The kit confirms install + parse + eligibility from `openclaw skills info --json`; runtime invocation belongs in a future Tier-C section.

Anything stronger belongs in a future Tier-C section, behind explicit runtime opt-in to MDA extensions.
