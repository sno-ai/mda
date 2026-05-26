# Compatibility: Codex CLI (SKILL.md)

**Claim (Tier B, narrow).** An MDA-compiled `SKILL.md` whose frontmatter stays inside the agentskills.io v1 envelope subset is discovered and parsed by Codex CLI when installed at the documented discovery paths. `name`, `description`, body, and the agentskills.io v1 envelope (including `allowed-tools`) survive the round-trip from `.mda` source to runtime ingest.

**Claim (negative).** Codex CLI's official documentation lists `name` and `description` as the only top-level frontmatter fields. Beyond those, agentskills.io v1 envelope fields (`license`, `compatibility`, `allowed-tools`, `metadata`) are inherited from the upstream standard; MDA v1.0 emits this subset. Anything Codex CLI honors outside agentskills.io v1 is undocumented in the public skills page and is out of MDA v1.0 scope.

**Last verified:** 2026-05-26 against `@markdown-ai/cli@1.1.3`, Codex CLI `0.133.0`.

## Directory contents

- `source.mda` — dedicated MDA source for this kit (do not reuse for unrelated examples)
- `build/SKILL.md` — reproducible compile output
- `verify.sh` — structural verification, no live install needed
- `install.sh` — optional live install to `~/.agents/skills/mda-compat-codex-cli/SKILL.md`
- `uninstall.sh` — removes the live install
- `notes.md` — scope, gaps, caveats, graduation criteria

## Quick verify (offline, modifies nothing on your system)

```sh
./compat/codex-cli/verify.sh
```

Re-compiles `source.mda`, validates the output against the SKILL.md JSON Schema, and confirms the envelope subset is intact. Exit 0 means the structural claim holds.

## Live verify (writes one file under `~/.agents/skills/`)

```sh
./compat/codex-cli/install.sh
```

Copies `build/SKILL.md` to `~/.agents/skills/mda-compat-codex-cli/SKILL.md`. Start (or resume) a Codex CLI session and confirm `mda-compat-codex-cli` is among the discovered skills.

To remove:

```sh
./compat/codex-cli/uninstall.sh
```

## How Codex CLI's loader actually behaves

From the official Codex CLI skills documentation (https://developers.openai.com/codex/skills):

- Skills build on the [agentskills.io](https://agentskills.io) open agent skills standard.
- Documented top-level frontmatter fields: `name`, `description` (both required).
- Discovery paths (in order): project-local `.agents/skills/` (walked from cwd up to repo root), user-level `~/.agents/skills/`, admin-level `/etc/codex/skills/`, plus bundled skills.
- Codex CLI follows symlinked skill folders during discovery.
- A skill lives at `<dir>/SKILL.md`; sibling resources are loaded on demand per agentskills.io v1.

In observed practice on this machine, Codex CLI also discovers skills under `~/.codex/skills/`. That path is not enumerated in the public skills documentation. This kit defaults to the documented `~/.agents/skills/` path; if your tree uses `~/.codex/skills/` instead, edit `install.sh` accordingly.

## What MDA emits today (v1.0)

The SKILL.md schema (`schemas/frontmatter-skill-md.schema.json`) permits these top-level fields, exactly:

| Field | Source | Notes |
| --- | --- | --- |
| `name` | author | Required by MDA. Must equal directory name (spec §06-2.1). |
| `description` | author | Required by MDA. Required by Codex CLI per docs. |
| `license` | author | Optional. Plain agentskills.io v1. |
| `compatibility` | author | Optional. Plain agentskills.io v1. |
| `allowed-tools` | author | Optional. Plain agentskills.io v1 (experimental upstream). |
| `metadata` | author | Optional. `metadata.mda.*` for MDA extensions, `metadata.<vendor>.*` reserved for vendor namespaces. Codex CLI does not document reading this namespace today. |
| `integrity` | compiler | Optional. Content digest. Codex CLI does not verify. |
| `signatures` | compiler/signer | Optional. DSSE envelope. Codex CLI does not verify. |

Everything else is rejected by `unevaluatedProperties: false`.

## What MDA does NOT emit today

The Codex CLI public docs do not enumerate top-level fields beyond `name` and `description`, so MDA's envelope subset matches the documented surface. One non-standard field observed in the wild (a `triggers:` array in at least one shipped Codex skill) is not part of agentskills.io v1 and is not authored by MDA v1.0. If Codex CLI adopts further runtime-specific top-level fields (the way Claude Code documents 11 extras), the same v1.1 graduation criterion in `docs/v1.0/what-v1.0-does-not-ship.md` covers them.

## What this kit does NOT claim

- That Codex CLI parses MDA-extended frontmatter (`metadata.mda.*`, `metadata.codex.*`, etc.).
- That signed MDA artifacts are verified at load time by Codex CLI.
- That `~/.agents/skills/<name>/SKILL.md` is the only discovery path Codex CLI uses. Project-local `.agents/skills/<name>/SKILL.md` works the same way; this kit just defaults to user-global for convenience.
- That the AGENTS.md target (a separate MDA-emitted file Codex CLI also reads as instructions) is verified by this kit. That belongs in a sibling AGENTS.md compat kit, not here.

Anything stronger belongs in a future Tier-C section, behind explicit runtime opt-in to MDA extensions.
