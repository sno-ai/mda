# CLAUDE.md — sno-ai/mda

Project memory for Claude Code. Read on every session.

## Release process for @markdown-ai/cli

**No more asking the user about version numbers, npm tokens, trusted
publishing, or auth.** Everything below is settled. Just execute.

### To cut a release (any 1.1.x, 1.2.0, 2.0.0 — same flow)

1. Edit `apps/cli/package.json` → bump `version`
2. `pnpm cli:test` (must pass; tests dynamically read the version)
3. `git add apps/cli/package.json && git commit -m "chore(cli): bump to <version>"`
4. `git push origin main`
5. `git tag v<version> HEAD`
6. `git push origin v<version>`
7. `gh run watch $(gh run list --workflow=publish-cli.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
8. `npm view @markdown-ai/cli@<version> version` to confirm registry
9. **Write real GitHub Release notes by hand and publish them.** See
   "Release notes — non-negotiable" below. This step is part of the
   release; the release is not done until the GitHub Release exists
   with a written body.

The user does not need to do anything for any of these steps. Do not ask
which version number to use — for a publish-only request, increment the
patch. Do not ask whether to write release notes — always write them.

### Release notes — non-negotiable

The GitHub Release body **must** be hand-written for every version.
`--generate-notes` produces a useless "Full Changelog: vA...vB" one-liner
when there are no merged PRs between tags (which is most patch releases
in this repo), so the workflow no longer creates the Release
automatically. Writing the body is the agent's responsibility.

Minimum required structure:

```md
## What's new

<one sentence per user-facing change, lead with the change name in bold.
example: **`mda demo`** — one command to see the four-artifact flow ...>

## Other changes

<bullet list of smaller things: docs, CI, internal>

## Why the version jump (only if patches were skipped)

<one paragraph explaining which version numbers were skipped and why>

## Install / upgrade

<copy-pasteable npm install + npx invocation>
```

Source for the notes: `git log --oneline <previous-shipped-tag>..v<new>
-- apps/cli/` plus `git show <commit>` on anything that looks
user-facing. Ignore `chore(cli): bump to ...` and pure-CI commits — they
are not what users care about. Group by user-visible feature, not by
commit.

Write the body to a temp file, then:

```sh
gh release create v<version> \
  --title "@markdown-ai/cli <version>" \
  --notes-file /tmp/v<version>-notes.md \
  --latest \
  --verify-tag
```

(Use `gh release edit ... --notes-file` if the release already exists.)

After creation, eyeball https://github.com/sno-ai/mda/releases/tag/v<version>
once to confirm the body actually renders the way you expect. If it
shows only "Full Changelog: vA...vB", the notes file was wrong — fix
and re-edit.

### Auth — already configured, do not touch

- npmjs.com has a Trusted Publisher binding on `@markdown-ai/cli`:
  - Repo: `sno-ai/mda`
  - Workflow: `publish-cli.yml`
  - Environment: (blank)
- Workflow uses OIDC via `id-token: write` permission. No NPM_TOKEN, no
  `registry-url` on setup-node, no `env: NODE_AUTH_TOKEN` block.
- Provenance is signed with sigstore via the same OIDC token.

If CI ever fails with `OIDC token exchange error - package not found`,
the binding was removed/changed npmjs-side. That is the only npmjs.com
issue worth flagging to the user — and only after confirming via the
verbose publish log. Do not preemptively ask them to "verify the
binding."

### What NOT to do (lessons from the v1.1.3–v1.1.6 publish loop)

- Do not add `NODE_AUTH_TOKEN` env or `registry-url` to setup-node.
  Either one breaks OIDC: empty `NODE_AUTH_TOKEN` makes npm send an
  empty bearer (404 from registry); a configured token blocks OIDC
  auto-detection entirely.
- Do not assume a 404 means "package missing" — npm registry returns
  404 for "auth ok but no permission" too. Read `--loglevel=verbose`
  output before guessing.
- Do not reuse a failed tag (don't delete and recreate `vX.Y.Z`). Bump
  the patch instead — tag deletion is destructive and unnecessary.
- Do not amend release commits or force-push. New commits only.
- Failed publish tags from 2026-05-26 (v1.1.3 through v1.1.6) are
  harmless leftovers. Do not delete them without explicit ask.

### When the publish fails

1. `gh run view <run-id> --log 2>&1 | awk '/Run npm publish/,/Process completed/'`
2. Diagnose from the verbose log alone — do not add diagnostic steps to
   the workflow unless the log is genuinely insufficient.
3. Communicate the exact npm error + the exact fix in one message. Do
   not ask the user to "check" or "verify" anything they can read off
   the URL you'd link them to.
