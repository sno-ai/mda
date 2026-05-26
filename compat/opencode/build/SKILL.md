---
name: mda-compat-opencode
description: MDA compatibility demonstration skill for OpenCode. Compiled from compat/opencode/source.mda. Loading this skill confirms that an MDA-emitted SKILL.md is discovered and parsed by OpenCode with the envelope subset of fields documented at opencode.ai/docs/skills/ honored.
metadata:
  mda:
    doc-id: 2f4b6a18-7c95-4e8a-b2f3-9d1c5e7a4f6b
    title: MDA Compat Demo (OpenCode)
    version: 1.0.0
    tags:
      - compat
      - demo
      - opencode
integrity:
  algorithm: sha256
  digest: sha256:52659350e5d2134780424a862283ff3a76400d122633139ab4b36b5092e515a9
---

# MDA Compat Demo (OpenCode)

This skill exists to verify OpenCode SKILL.md compatibility from an MDA-compiled output.

Three things are true if OpenCode discovers and loads this skill:

1. The compiled `SKILL.md` parses under OpenCode's loader.
2. The frontmatter `name` matches the package directory name (spec §06-2.1 and OpenCode's own naming rules).
3. The five documented top-level fields (`name`, `description`, `license`, `compatibility`, `metadata`) plus MDA's `integrity` survive the round-trip from `.mda` source to compiled output to runtime ingest.

Source: `compat/opencode/source.mda`. Compile: `mda compile compat/opencode/source.mda --target SKILL.md --out-dir compat/opencode/build --integrity`.

What this does NOT prove:

- That OpenCode parses MDA-extended frontmatter under `metadata.mda.*` (the OpenCode docs do not document any such behavior, and we do not require it; per docs "unknown frontmatter fields are ignored", so passthrough is safe).
- That signatures or integrity digests are verified at load time (no current runtime does that).
- That `allowed-tools` is honored — OpenCode's public docs do not list this field. MDA may emit it (agentskills.io v1 envelope), but OpenCode's behavior on it is undocumented.
