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

The user does not need to do anything for any of these steps. Do not ask
which version number to use — for a publish-only request, increment the
patch.

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
