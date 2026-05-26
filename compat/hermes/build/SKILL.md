---
name: mda-compat-hermes
description: MDA compatibility demonstration skill for Hermes Agent. Compiled from compat/hermes/source.mda. Loading this skill confirms that an MDA-emitted SKILL.md is discovered, parsed, and listed by Hermes Agent under its `~/.hermes/skills/<category>/<name>/SKILL.md` layout.
metadata:
  mda:
    doc-id: 4a9e7c12-5b83-4d6f-a1c8-7e2f9b4d5c6a
    title: MDA Compat Demo (Hermes Agent)
    version: 1.0.0
    tags:
      - compat
      - demo
      - hermes
  hermes:
    tags:
      - Compat
      - MDA
      - Demo
    related_skills:
      - hermes-agent
integrity:
  algorithm: sha256
  digest: sha256:db1e71f8026d810ccb3464dc0d7841e08b13ea87d85eb4c23de797109d795c4d
---

# MDA Compat Demo (Hermes Agent)

This skill exists to verify Hermes Agent SKILL.md compatibility from an MDA-compiled output.

Three things are true if Hermes discovers and loads this skill:

1. The compiled `SKILL.md` parses under Hermes Agent's loader.
2. The frontmatter `name` matches the package directory name (spec §06-2.1).
3. The agentskills.io v1 envelope subset survives the round-trip from `.mda` source to compiled output to Hermes' skill registry; the reserved `metadata.hermes.*` namespace passes through verbatim for Hermes' own consumption.

Source: `compat/hermes/source.mda`. Compile: `mda compile compat/hermes/source.mda --target SKILL.md --out-dir compat/hermes/build --integrity`.

What this does NOT prove:

- That Hermes parses MDA-extended frontmatter under `metadata.mda.*` (we do not require it).
- That signatures or integrity digests are verified at load time (no current runtime does that).
- That MDA v1.0 can author Hermes-specific top-level fields (`version`, `author`) that some existing Hermes skills carry at top level rather than under `metadata.mda.*`. Those are out of MDA v1.0 scope under §06-3.4, symmetric with the Claude Code runtime-fields gap.
