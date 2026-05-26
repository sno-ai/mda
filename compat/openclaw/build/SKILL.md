---
name: mda-compat-openclaw
description: MDA compatibility demonstration skill for OpenClaw. Compiled from compat/openclaw/source.mda. Loading this skill confirms that an MDA-emitted SKILL.md installs cleanly via `openclaw skills install <local-dir> --global` and is reported as parsed by `openclaw skills info --json`.
metadata:
  mda:
    doc-id: 6c8d3f55-9a1b-4e7c-b5d2-2e8f4a9c1b3d
    title: MDA Compat Demo (OpenClaw)
    version: 1.0.0
    tags:
      - compat
      - demo
      - openclaw
integrity:
  algorithm: sha256
  digest: sha256:7150f454645d545f2c2b6b7c9e8dc269add7ffe8789926e97170c9e1dad30c4a
---

# MDA Compat Demo (OpenClaw)

This skill exists to verify OpenClaw SKILL.md compatibility from an MDA-compiled output.

Three things are true if OpenClaw discovers and loads this skill:

1. `openclaw skills install <dir> --global` accepts the MDA-emitted file.
2. The frontmatter `name` matches the package directory name (spec §06-2.1).
3. The agentskills.io v1 envelope subset (`name`, `description`) survives the round-trip from `.mda` source to compiled output to OpenClaw's managed plugin-skills directory.

Source: `compat/openclaw/source.mda`. Compile: `mda compile compat/openclaw/source.mda --target SKILL.md --out-dir compat/openclaw/build --integrity`.

What this does NOT prove:

- That OpenClaw parses MDA-extended frontmatter under `metadata.mda.*` (we do not require it).
- That signatures or integrity digests are verified at load time (no current runtime does that).
- That MDA v1.0 can author OpenClaw-specific top-level fields (e.g. `user-invocable`, which one shipped OpenClaw skill carries at top level). Those are out of MDA v1.0 scope under §06-3.4, symmetric with the Claude Code runtime-fields gap.
