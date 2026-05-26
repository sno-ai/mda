# §04 — Platform Namespaces

> **Status:** Stable
> **Registry:** [`REGISTRY.md`](../../REGISTRY.md)
> **Schema:** [`schemas/_defs/metadata-namespaces.schema.json`](../../schemas/_defs/metadata-namespaces.schema.json)
> **Depends on:** §02 (frontmatter)

## §04-1 Synopsis

MDA's `metadata` frontmatter object is the canonical extension hook (§02-2.5). Each top-level key under `metadata` is a **vendor namespace** that belongs to exactly one vendor, runtime, or registry. This section defines the rules; the live assignment list and governance live in `REGISTRY.md`.

## §04-2 Why namespaces exist

Three problems they solve:

1. **Collision avoidance.** Without namespaces, two unrelated vendors that both want to declare `display_name` at the top level will silently overwrite each other.
2. **Loader scoping.** Each vendor's loader can read only its own namespace and ignore everything else, which is cheap and predictable.
3. **Author clarity.** A reader of an MDA file can tell at a glance which fields are universal, which are MDA-specific, and which are runtime-specific.

## §04-3 Reserved keys

The following top-level `metadata` keys are reserved and MUST NOT be assigned to any vendor:

- `mda` — owned by the MDA spec itself; carries MDA-extended frontmatter in compiled outputs (§02-3, §03-4).
- `default`, `__proto__`, `constructor`, `prototype` — JavaScript/JSON-toolchain hazards.
- Any key beginning with `_` (underscore) — reserved for future spec-internal use.

## §04-4 Key constraints

Every namespace key (other than the reserved set above) MUST satisfy the kebab-case identifier shape (`schemas/_defs/name.schema.json`):

- Regex `^[a-z0-9]+(-[a-z0-9]+)*$`
- Length 1-64
- No leading/trailing hyphen, no consecutive hyphens

## §04-5 Loader expectations

A conforming MDA-aware tool:

- MUST recognize every namespace marked `Stable` in `REGISTRY.md`.
- MAY recognize `Provisional` namespaces.
- MUST NOT reject a frontmatter document solely because it contains an unregistered namespace whose key satisfies §04-4. A linter MAY emit a warning suggesting registration.

A vendor's runtime loader (e.g. Claude Code, Codex, Hermes, OpenCode) is expected to read **only** its own namespace and to ignore the rest. Cross-namespace reads are a smell.

### §04-5.1 Compiler treatment of unknown namespaces

A conforming MDA compiler:

- MUST preserve every `metadata.<vendor>.*` namespace from the source verbatim in every compiled output, regardless of whether the vendor key is registered.
- MUST NOT interpret, validate, or rewrite the contents of a namespace it does not own (only `metadata.mda.*` is owned by the MDA spec).
- MUST NOT project a namespace into a sibling file. Vendors that need a sibling file MUST author it themselves; sibling-file projection was considered for v1.0 and cut.

## §04-6 Examples

A `.mda` source carrying configuration for three vendors at once:

```yaml
---
name: pdf-tools
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
metadata:
  mda:
    doc-id: 38f5a922-81b2-4f1a-8d8c-3a5be4ea7511
    tags: [pdf, extraction]
  claude-code:
    allowed-tools: "Read Bash(pdftotext:*) Bash(jq:*)"
    disable-model-invocation: false
  codex:
    display_name: "PDF Tools"
    allow_implicit_invocation: true
  hermes:
    requires_tools: ["pdftotext", "jq"]
    required_environment_variables:
      - { name: PDF_API_KEY, prompt: "Provide your PDF API key" }
---
```

When this source compiles to `pdf-tools/SKILL.md`, the frontmatter is preserved verbatim. The MDA compiler touches only `metadata.mda`. Each vendor namespace is **reserved** for its named consumer — `metadata.claude-code` for Claude Code, `metadata.codex` for Codex CLI, `metadata.hermes` for Hermes Agent — but whether and how each runtime reads its namespace is a per-runtime decision outside the MDA contract.

As of v1.0, **no Tier-1 SKILL.md consumer is known to read its `metadata.<vendor>.*` namespace**. Runtimes that extend the agentskills.io v1 envelope do so via documented top-level fields, which are out of MDA v1.0 scope per §06-3.4. The namespace pattern is forward-looking: it exists so that a vendor opting in later has a stable, collision-free home, and so that authors who hand-edit compiled output have a recommended place for vendor-specific overrides. Authors should not assume current runtime behavior matches the namespace reservation.

## §04-7 Adding a new namespace

The full registration process is in `REGISTRY.md`. In short:

1. Open a PR adding a row to the registry table.
2. Provide upstream documentation URL, contact, and rationale.
3. Reviewer checks key conformance, collision, and on-topic-ness.
4. On merge, namespace starts as `Provisional`; graduates to `Stable` after observable production use.

## §04-8 Rationale

- **Why reserve `mda` for ourselves?** Because the compile contract (§01-4) puts MDA-extended frontmatter under `metadata.mda` in every output. Letting a vendor claim it would break compiled outputs.
- **Why allow unregistered kebab-case keys at all?** To let new vendors experiment without a paperwork barrier. Validators warn but do not reject.
- **Why is the registry in the repo and not on a website?** Because the schema (`schemas/_defs/metadata-namespaces.schema.json`) and the registry should land in the same PR. A website registry adds latency and a coordination problem the spec doesn't need.
- **Why no sibling-file projection in v1.0?** It was an attractive feature, but vendors that need it can author the sibling file themselves; baking it into the compiler creates a coupling between the compiler and every vendor's file conventions, which the v1.0 surface area cannot afford.
