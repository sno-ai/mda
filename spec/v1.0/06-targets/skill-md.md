# §06-targets/skill-md — SKILL.md target schema

> **Status:** Stable (Tier 1)
> **Schema:** [`schemas/frontmatter-skill-md.schema.json`](../../../schemas/frontmatter-skill-md.schema.json)
> **Upstream standard:** agentskills.io v1 — https://agentskills.io/specification
> **Depends on:** §00, §01, §02, §03, §04, §05

## §06-1 Synopsis

This section is the **target schema** the MDA compiler emits when producing a file named `SKILL.md`. It is the contract MDA owes to every agentskills.io-conforming consumer: Claude Code, OpenCode, OpenAI Codex, Hermes Agent, OpenClaw, skills.sh, Cursor, Windsurf, and others.

The schema is reproduced here in full so this specification is self-contained. Where MDA's view differs from the upstream wording, MDA's view is normative within MDA. Where they agree (which is almost everywhere), the upstream remains the ultimate source.

Authors MAY produce a SKILL.md by any of the three modes in §0.6: directly (Agent or Human mode) or by compiling a `.mda` source. Either path MUST yield an output that satisfies every clause below.

## §06-2 Directory layout

A SKILL.md package is a directory:

```
<skill-name>/
├── SKILL.md          # required: frontmatter + Markdown instructions
├── scripts/          # optional: executable code (Python, TypeScript, Bash, Rust, ...)
├── references/       # optional: docs loaded on demand
├── assets/           # optional: templates, images, schemas
└── ...               # any additional files
```

### §06-2.1 Directory name

The package directory name MUST equal the frontmatter `name` field.

### §06-2.2 Discovery paths (informational)

When the package is placed in any of the canonical discovery paths, no further configuration is required for the listed consumer:

- Project-local: `.opencode/skills/`, `.claude/skills/`, `.agents/skills/`
- User-global: `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`, `~/.hermes/skills/`

## §06-3 Frontmatter

The emitted `SKILL.md` MUST start with YAML frontmatter delimited by `---` lines. The strict shape is enforced by `schemas/frontmatter-skill-md.schema.json` (`unevaluatedProperties: false`).

### §06-3.1 Required fields

| Field | Constraint |
| ----- | ---------- |
| `name` | 1-64 chars; lowercase a-z, 0-9, `-` only; no leading/trailing hyphen; no consecutive hyphens; matches package directory name (§06-2.1) |
| `description` | 1-1024 chars; non-empty; SHOULD describe what the skill does AND when to invoke it |

### §06-3.2 Optional fields

| Field | Constraint |
| ----- | ---------- |
| `license` | License identifier or filename of bundled license file |
| `compatibility` | ≤500 chars; environment requirements (intended product, system packages, network access, runtime) |
| `metadata` | Free-form key→object map; MDA-extended fields nest under `metadata.mda.*`, per-vendor fields under `metadata.<vendor>.*` (see §04) |
| `allowed-tools` | Space-separated tool whitelist (experimental upstream; honored where supported) |
| `integrity` | Optional content hash (§02-2.7, §08) |
| `signatures` | Optional DSSE signatures array (§02-2.8, §09); `integrity` REQUIRED when present |

### §06-3.3 Forbidden top-level fields

No other top-level fields are permitted in the output. The schema enforces this with `unevaluatedProperties: false`. In particular, the following MDA-extended fields MUST NOT appear at the top level of a SKILL.md output and MUST instead nest under `metadata.mda.*`:

`doc-id`, `title`, `version`, `requires`, `relationships`, `depends-on`, `created-date`, `updated-date`, `author`, `tags`.

### §06-3.4 Out of scope: runtime-specific top-level fields

MDA v1.0's SKILL.md schema covers the **agentskills.io v1 envelope subset** (§06-3.1, §06-3.2) plus MDA's own `integrity` and `signatures`. Individual Tier-1 consumers extend that surface with runtime-specific top-level fields that are not part of agentskills.io v1.

Notably, Claude Code documents 15 top-level frontmatter fields (https://code.claude.com/docs/en/skills). Eleven of those are runtime-specific and outside agentskills.io v1: `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`.

In MDA v1.0:

- These runtime-specific fields are out of scope. The compiler does not emit them and the validator rejects them at the top level under `unevaluatedProperties: false`.
- A SKILL.md hand-edited to include these fields post-compile is no longer an MDA-validated artifact; it is a vendor-specific extension of the compiled output.
- A SKILL.md source that needs those fields today either (a) ships the agentskills.io v1 subset under MDA and accepts a post-compile hand-edit, or (b) authors the SKILL.md directly in Human or Agent mode (§0.6) without round-tripping through MDA validation.

The v1.0 boundary is deliberate. MDA freezes the cross-runtime portable subset; per-runtime feature expansion is a v1.x concern driven by observed adoption. Graduation of this gap to a future minor release is tracked in `docs/v1.0/what-v1.0-does-not-ship.md`.

The same scope statement applies in principle to other Tier-1 SKILL.md consumers (OpenCode, Codex, Hermes Agent, Cursor, Windsurf) when and where they extend the envelope. v1.0 does not enumerate their runtime-specific fields.

## §06-4 Body

The Markdown body following the frontmatter:

- MUST be standard Markdown.
- SHOULD stay within the body-tier guidance in §05.
- MAY contain standard Markdown footnotes `[^id]: ...` (they degrade gracefully in SKILL-only consumers).

## §06-5 Progressive disclosure

The package MUST follow the three-tier loading model defined in §05:

- Tier 1 — frontmatter `name` + `description` (~100 tokens).
- Tier 2 — full `SKILL.md` body.
- Tier 3 — files in `scripts/` `references/` `assets/` (on demand).

## §06-6 Footnote relationship handling

When the source contains MDA relationship footnotes (§03):

- The compiler MAY preserve the footnote definitions verbatim in the SKILL.md body.
- The compiler MUST also serialize the same payloads to `metadata.mda.relationships` in the output frontmatter (§03-4).

This makes the relationship graph machine-readable to SKILL-aware indexers without a footnote parser.

## §06-7 Validation

The MDA compiler and validator MUST validate the emitted `SKILL.md` against `schemas/frontmatter-skill-md.schema.json` and against §06-2 through §06-6 before declaring a successful build. Compatibility with the upstream `skills-ref validate` reference checker (https://github.com/agentskills/agentskills/tree/main/skills-ref) is a goal.

## §06-8 Conformance summary

An emitted `SKILL.md` package is conformant iff:

1. It lives at `<name>/SKILL.md` with the directory name matching frontmatter `name`. (§06-2.1)
2. Top-level frontmatter contains only the fields listed in §06-3.1 and §06-3.2, with `name` and `description` required. (`unevaluatedProperties: false` enforced.)
3. Body is standard Markdown. (§06-4)
4. All MDA-extended frontmatter is nested under `metadata.mda.*`; all per-vendor fields under `metadata.<vendor>.*`. (§06-3.3, §04)
5. Body length and resource layout follow §05.
6. If the source had relationship footnotes, the `metadata.mda.relationships` mirror MUST be present. (§06-6, §03-4)
7. If `signatures[]` is present, `integrity` MUST also be present and every signature's `payload-digest` MUST equal `integrity.digest`. (§08, §09)

## §06-9 Field mapping (informative)

| MDA-source location                                              | SKILL.md output target                                                       | Notes |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----- |
| `name`                                                           | top-level `name`                                                             | Required. |
| `description`                                                    | top-level `description`                                                      | Required. ≤1024 chars. |
| `license`                                                        | top-level `license`                                                          | Optional. |
| `compatibility`                                                  | top-level `compatibility`                                                    | Optional. |
| `allowed-tools`                                                  | top-level `allowed-tools`                                                    | Experimental upstream. |
| `integrity`, `signatures`                                        | top-level `integrity`, top-level `signatures`                                | Per §02-2.7 / §02-2.8. |
| `title`                                                          | `metadata.mda.title`                                                         | MDA-extended. |
| `doc-id`                                                         | `metadata.mda.doc-id`                                                        | MDA-extended; relationship-graph address. |
| `version`                                                        | `metadata.mda.version`                                                       | MDA-extended. |
| `requires`                                                       | `metadata.mda.requires`                                                      | MDA-extended; see §10. |
| `depends-on`                                                     | `metadata.mda.depends-on`                                                    | MDA-extended; see §03-3. |
| `author`                                                         | `metadata.mda.author`                                                        | Open standard does not define `author`. |
| `tags`                                                           | `metadata.mda.tags`                                                          | Open standard does not define `tags`. |
| `created-date`, `updated-date`                                   | `metadata.mda.created-date`, `metadata.mda.updated-date`                     | Quoted strings (§02-3.1). |
| `relationships`                                                  | `metadata.mda.relationships`                                                 | Mirror REQUIRED when source has footnote relationships. |
| Markdown footnote `[^id]: { JSON }`                              | optional body retention + REQUIRED mirror at `metadata.mda.relationships`    | §03-4. |

## §06-10 Examples

See `examples/skill-md/intro/` for a minimal conformant package, and `examples/skill-md/pdf-tools/` (when added) for one that exercises multi-vendor `metadata` namespaces and tier-3 resources.
