# MDA examples

Worked examples cross-referenced from the specification (`spec/v1.0/`).

| Path                                        | Demonstrates                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source-only/intro.mda`                     | A `.mda` source that uses every MDA-extended construct: extended frontmatter, inline `ai-script`, footnote relationship.                                       |
| `source-only/tweetclaw-social-workflow.mda` | A `.mda` source for an OpenClaw-compatible SKILL.md workflow that collects X/Twitter evidence and keeps TweetClaw write-like actions behind explicit approval. |
| `skill-md/intro/`                           | The compiled SKILL.md package equivalent of `source-only/intro.mda`. Exercises §07-targets/skill-md.md end to end.                                             |

When the compiler ships, `mda compile examples/source-only/intro.mda --target skill-md --out examples/skill-md/intro` MUST produce a directory byte-equivalent to `skill-md/intro/`.

These two directories also serve as canonical fixtures for `conformance/compile/`.
