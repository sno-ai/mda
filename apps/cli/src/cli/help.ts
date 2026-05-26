export const HELP = `Markdown AI CLI (@markdown-ai/cli)

Usage:
  mda
  mda --help
  mda --version
  mda init <name> [--out <file>] [--json]
  mda init --template llmix-preset --module <name> --preset <name> --provider <provider> --model <model> [--out <file>] [--json]
  mda demo [--out-dir <dir>] [--json]
  mda validate <file> [--target source|SKILL.md|AGENTS.md|MCP-SERVER.md|auto] [--json]
  mda compile <file.mda> --target <target...> [--out-dir <dir>] [--integrity] [--manifest <path>] [--strict-compat] [--json]
  mda canonicalize <file> [--target source|SKILL.md|AGENTS.md|MCP-SERVER.md|auto] [--sidecar <path>] [--json]
  mda integrity compute <file> [--target source|SKILL.md|AGENTS.md|MCP-SERVER.md|auto] [--sidecar <path>] [--algorithm sha256|sha384|sha512] [--write] [--json]
  mda integrity verify <file> [--target source|SKILL.md|AGENTS.md|MCP-SERVER.md|auto] [--sidecar <path>] [--json]
  mda sign <file> --profile did-web --did <did> --key-id <key-id> --key-file <path> (--out <file>|--in-place) [--json]
  mda sign <file> --profile github-actions --repo <owner/repo> --workflow <workflow> --ref <ref> --rekor --offline-sigstore-fixture <path> (--out <file>|--in-place) [--json]
  mda sign <file> --method did-web --key <path> --identity <domain> (--out <file>|--in-place) [--json]
  mda verify <file> --policy <path> [--did-document <path>] [--offline-sigstore-fixture <path>] [--target source|SKILL.md|AGENTS.md|MCP-SERVER.md|auto] [--sidecar <path>] [--json]
  mda release trust policy --target llmix-registry --profile github-actions --repo <owner/repo> --workflow <workflow> --ref <ref> [--out <file>] [--json]
  mda release trust policy --target llmix-registry --profile did-web --domain <domain> [--min-signatures <n>] [--out <file>] [--json]
  mda release prepare --target llmix-registry --source <dir> --registry-dir <dir> --policy <path> --out <file> [--did-document <path>] [--offline-sigstore-fixture <path>] [--json]
  mda release finalize --target llmix-registry --registry-dir <dir> --registry-root <file> --release-plan <file> --policy <path> (--expected-root-digest <digest>|--derive-root-digest) [--minimum-revision <rev>] [--minimum-published-at <iso>] [--high-watermark <value>] --out <file> [--did-document <path>] [--offline-sigstore-fixture <path>] [--json]
  mda release finalize --target llmix-registry --registry-dir <dir> --manifest <path> --snippet-format json|env|kubernetes|github-actions|terraform|typescript|python|rust --snippet-out <path> [--json]
  mda doctor release --target llmix-registry --source <dir> --registry-dir <dir> --release-plan <path> --manifest <path> [--did-document <path>] [--offline-sigstore-fixture <path>] [--json]
  mda conformance [--suite <path>] [--level V|C] [--json]

Global flags:
  --json       Print stable JSON only on stdout.
  --quiet      Suppress non-essential human output.
  --verbose    Include extra diagnostic context where available.
  --no-color   Disable ANSI color.
  --no-next    Omit human Next: guidance. JSON nextActions are unchanged.
  -h, --help   Print this full help.
  -v, --version
              Print the CLI package version from package.json.

Commands and options:
  init <name>
    --out <file>                 Write the scaffold atomically. Refuses overwrite.
    --json                       Return scaffold in JSON instead of raw .mda text.
    --template llmix-preset      Generate an LLMix preset source artifact.
    --module <name>              LLMix module name, e.g. search_summary or _default.
    --preset <name>              LLMix preset name, e.g. openai_fast or _base.
    --provider <provider>        openai, anthropic, google, deepseek, openrouter, deepinfra, novita, together, or sno-gpu.
    --model <model>              Provider model identifier.

  demo
    --out-dir <dir>              Output directory for the demo source and compiled outputs. Default: mda-demo.
                                 Writes hello.mda plus out/SKILL.md, out/AGENTS.md, out/MCP-SERVER.md, out/mcp-server.json with integrity.

  validate <file>
    --target <target>            source, SKILL.md, AGENTS.md, MCP-SERVER.md, or auto. Default: auto.

  compile <file.mda>
    --target <target...>         Required. One or more of SKILL.md, AGENTS.md, MCP-SERVER.md.
    --out-dir <dir>              Output directory. Default: current working directory.
    --integrity                  Add sha256 integrity to emitted artifacts.
    --manifest <path>            Write compile evidence with source digest, output digests, capabilities, and warnings.
    --strict-compat              Treat compatibility warnings as compile failures before writing outputs.

  canonicalize <file>
    --target <target>            Default: auto.
    --sidecar <path>             Required only for MCP-SERVER.md multi-file canonical bytes.

  integrity compute <file>
    --target <target>            Default: auto.
    --sidecar <path>             Required only for MCP-SERVER.md.
    --algorithm <name>           sha256, sha384, or sha512. Default: sha256.
    --write                      Write the computed digest into frontmatter.integrity. Refuses mismatched existing integrity.

  integrity verify <file>
    --target <target>            Default: auto.
    --sidecar <path>             Required only for MCP-SERVER.md.

  verify <file>
    --policy <path>              Required trust policy JSON.
    --did-document <path>        Local did:web document fixture for deterministic verification.
    --offline-sigstore-fixture <path>
                                 Local Sigstore/Rekor fixture for deterministic GitHub Actions verification.
    --target <target>            Default: auto.
    --sidecar <path>             Required only for MCP-SERVER.md.
    --offline                    Unsupported; use explicit profile evidence fixtures instead.

  sign <file>
    --profile did-web            Sign with a did:web key and DSSE PAE integrity payload.
    --did <did>                  Required for --profile did-web, e.g. did:web:example.com.
    --key-id <key-id>            Required verification method id in the DID document.
    --key-file <path>            Required private key PEM.
    --method did-web             Compatibility alias for --profile did-web.
    --key <path>                 Compatibility alias for --key-file.
    --identity <domain>          Compatibility alias for --did did:web:<domain>.
    --profile github-actions     Sign with explicit GitHub Actions Sigstore/Rekor fixture evidence.
    --repo <owner/repo>          Required GitHub repository for --profile github-actions.
    --workflow <workflow>        Required workflow file or workflow identity.
    --ref <ref>                  Required exact Git ref.
    --rekor                      Required explicit Rekor evidence acknowledgement.
    --offline-sigstore-fixture <path>
                                 Required local Sigstore/Rekor fixture for deterministic signing.
    --out <file>                 Write signed output.
    --in-place                   Replace the input file.

  release trust policy
    --target llmix-registry     Required. Generate trust policy for the LLMix registry release target.
    --profile did-web            Generate a schema-valid did:web trust policy.
    --domain <domain>            Trusted did:web domain.
    --min-signatures <n>         Minimum trusted signatures. Default: 1.
    --profile github-actions     Generate a schema-valid Sigstore/Rekor policy.
    --repo <owner/repo>          Trusted GitHub repository.
    --workflow <workflow>        Trusted workflow file or workflow identity.
    --ref <ref>                  Trusted exact Git ref, e.g. refs/heads/main.
    --out <file>                 Write policy JSON atomically. Refuses overwrite.

  release prepare
    --target llmix-registry      Required. Prepare a verified LLMix registry release plan.
    --source <dir>               Directory containing signed LLMix .mda preset sources.
    --registry-dir <dir>         Target LLMix registry directory. This command reads only and never publishes registry files.
    --policy <path>              Trust policy used to verify every source signature.
    --did-document <path>        Local did:web document fixture when using did:web signatures.
    --offline-sigstore-fixture <path>
                                 Local Sigstore/Rekor fixture when using GitHub Actions signatures.
    --out <file>                 Write the deterministic release plan atomically. Refuses overwrite.

  release finalize
    --target llmix-registry      Required. Finalize LLMix registry release trust artifacts.
    --registry-dir <dir>         Published LLMix registry directory. Manifest output is rejected inside this directory.
    --registry-root <file>       Signed registry-root evidence JSON.
    --release-plan <file>        Verified release plan produced before registry publication.
    --policy <path>              Trust policy used to verify registry-root signatures.
    --expected-root-digest <d>   Pin the exact registry-root digest.
    --derive-root-digest         Derive expectedRootDigest from verified registry-root evidence.
    --minimum-revision <rev>     Reject registry roots older than this revision.
    --minimum-published-at <iso> Reject registry roots published before this timestamp.
    --high-watermark <value>     Reject roots below this monotonic high-watermark.
    --out <file>                 Write the external deployment trust manifest. Refuses overwrite.
    --manifest <path>            Existing external trust manifest for snippet generation.
    --snippet-format <format>    json, env, kubernetes, github-actions, terraform, typescript, python, or rust.
    --snippet-out <file>         Write the deployment snippet atomically. Refuses overwrite.

  doctor release
    --target llmix-registry      Required. Check LLMix registry release readiness.
    --source <dir>               Directory containing LLMix .mda preset sources.
    --registry-dir <dir>         Published LLMix registry directory.
    --release-plan <path>        Verified release plan used for the signed registry root.
    --manifest <path>            External deployment trust manifest.
    --did-document <path>        Local DID document for did:web registry-root signature verification.
    --offline-sigstore-fixture <path>
                                  Deterministic Sigstore/Rekor fixture for registry-root verification.

Examples:
  mda init hello-skill --out hello.mda
  mda init --template llmix-preset --module search_summary --preset openai_fast --provider openai --model gpt-5-mini --out search_summary/openai_fast.mda
  mda demo
  mda validate hello.mda --json
  mda compile hello.mda --target SKILL.md AGENTS.md MCP-SERVER.md --out-dir out --integrity --manifest out/compile-manifest.json
  mda canonicalize out/SKILL.md --target SKILL.md --json
  mda integrity compute out/SKILL.md --target SKILL.md --algorithm sha256 --json
  mda integrity verify out/SKILL.md --target SKILL.md
  mda verify signed.md --policy policy.json --json
  mda release trust policy --target llmix-registry --profile github-actions --repo owner/repo --workflow release.yml --ref refs/heads/main --out release/source-policy.json --json
  mda release prepare --target llmix-registry --source config/llm/source --registry-dir config/llm --policy release/source-policy.json --out release/plan.json --json
  mda release finalize --target llmix-registry --registry-dir config/llm --registry-root config/llm/compiled/<revision>/registry-root.json --release-plan release/plan.json --policy release/root-policy.json --derive-root-digest --out release/llmix-trust.json --json
  mda release finalize --target llmix-registry --registry-dir config/llm --manifest release/llmix-trust.json --snippet-format json --snippet-out release/llmix-trust-snippet.json --json
  mda doctor release --target llmix-registry --source config/llm/source --registry-dir config/llm --release-plan release/plan.json --manifest release/llmix-trust.json --did-document did.json --json
  mda conformance --suite conformance --level V --json

Exit codes:
  0  Success.
  1  Valid command, but artifact validation or verification failed.
  2  CLI usage error: missing argument, unknown flag, ambiguous target.
  3  IO or configuration error: missing file, overwrite refusal, unreadable policy.
  4  Internal bug or invariant failure.
`;
