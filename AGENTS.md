# ORBIT Development Instructions

## Canonical source

- These instructions apply equally to work requested through Slack/Hermes, ChatGPT/Codex, Claude, and local development. Read this file from the freshly fetched `main` at the start of every task.
- The authoritative development source is the remote default branch `main` in `https://github.com/roybeee/ORBIT`.
- Before starting any work, fetch the remote and verify the exact current `origin/main` SHA. Do not rely on a cached local branch, an existing worktree name, or a previously reported SHA.
- Create every new work branch from the verified remote `main`.
- `archive/main-76769c8` is preserved historical reference only. Do not branch from it, merge it wholesale, or treat it as the current product unless the owner explicitly reverses this decision.

## Development workflow

1. Verify that `origin` points to `roybeee/ORBIT` on GitHub, then run `git fetch origin --prune`. A Sites checkout must use a separately named remote for Sites; its `main` is not the development base.
2. Confirm `git rev-parse origin/main` matches `git ls-remote origin refs/heads/main`.
3. Start a new feature or fix branch from `origin/main`.
4. Keep migrations append-only from the current `main`; never reuse a migration number from an archived or stale branch.
5. Run `npm run typecheck` and `npm test` before opening or merging a pull request.
6. Merge only after `Validate Orbit` succeeds, then read back the remote `main` SHA.

- At the start of an ongoing task, reconcile any newer remote changes with the work branch before continuing. Preserve uncommitted work; use an isolated worktree when necessary. Never reset or force-push another agent's work.
- Fetch again before merging. If `main` moved, integrate it and rerun the required checks on the resulting code. A successful check on an older head is insufficient.
- Record the verified base SHA and validation results in the PR. On completion, report the merged SHA and distinguish source synchronization from deployment.
- Do not pin future work to a release number or a SHA from chat history. Historical source hashes document provenance only; the latest verified GitHub `main` always determines the next base.

## Release boundary

- Product changes must reach GitHub `main` through a validated PR before the resulting source is published to Sites. Do not create a separate Sites-only development line.
- Publish from the exact verified merged GitHub source. If Sites assigns a different commit or version identifier, record its mapping to the GitHub SHA and verify that the application files match. Check for concurrent changes before publication.
- A GitHub merge is a source release, not a ChatGPT Sites deployment.
- Do not report production deployment until Sites publication and the authenticated production behavior are separately verified.
- The Android wrapper, Sites runtime, and GitHub source may have different versions; identify each explicitly when relevant.
- Repository instructions do not prove that a remote Slack/Hermes process has refreshed its checkout. Do not claim that its local configuration or running session was updated without verifying it.
