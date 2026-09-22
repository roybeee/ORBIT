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
4. Keep migrations append-only from the current `main`; never reuse a migration number from an archived or stale branch. A migration number is provisional until the PR merges: generate it with `npm run db:generate` (the tests need the file), but regenerate it on top of the integrated `main` whenever `main` added migrations while the branch was open.
5. Run `npm run typecheck` and `npm test` before opening or merging a pull request.
6. Merge only after `Validate Orbit` succeeds, then read back the remote `main` SHA.

- At the start of an ongoing task, reconcile any newer remote changes with the work branch before continuing. Preserve uncommitted work; use an isolated worktree when necessary. Never reset or force-push another agent's work.
- Fetch again before merging. If `main` moved, integrate it and rerun the required checks on the resulting code. A successful check on an older head is insufficient.
- Record the verified base SHA and validation results in the PR. On completion, report the merged SHA and distinguish source synchronization from deployment.
- Do not pin future work to a release number or a SHA from chat history. Historical source hashes document provenance only; the latest verified GitHub `main` always determines the next base.

## Parallel integration loop

- `main` is protected by the `main-integration` ruleset: pull request required (merge commits only), `Validate Orbit` (`validate`) required on a head that is up to date with `main`, no deletion or force-push, no bypass. A green check on an outdated head can no longer merge: when another PR lands first, yours becomes "behind" and must integrate the new `main` and pass CI again. (GitHub merge queues are only offered to organization-owned repositories; `github-setup.sh --merge-queue` switches to one if the repository moves.)
- Merging means enabling auto-merge: `gh pr merge <n> --auto --merge` (or "Enable auto-merge" in the UI). It completes only when the PR is up to date and green. If it reports "behind", update the branch (`gh pr update-branch <n>` or `scripts/parallel/sync.sh`) and let CI re-run. After the merge, read back the remote `main` SHA before reporting.
- One task = one worktree from the verified remote `main`. The helper scripts in `scripts/parallel/` implement this loop: `start.sh <slug>` (verified base + worktree + install), `sync.sh` (integrate the latest `main`, re-run checks), `finish.sh` (push, PR with base SHA and tree, auto-merge, re-sync when behind, wait for the merged SHA), `status.sh` (drift/PR/CI/queue board), `cleanup.sh`, `release.sh` and `verify-deploy.sh`. See `docs/Parallel_Loop.ko.md`.
- Conflict prevention: migrations are append-only and `scripts/check-migrations.mjs` runs in CI (journal indexes, files, snapshot chain, and no renumbering of migrations already on the base). If two branches generated the same number, the later one regenerates its migration on top of the integrated `main`: take `main`'s `drizzle/meta/` verbatim (`git checkout origin/main -- drizzle/meta/`), delete the draft `drizzle/NNNN_*.sql`, re-run `npm run db:generate`, and rename the generated file and its journal `tag` together if a descriptive name is wanted (snapshots are numbered, not named). Never hand-edit a snapshot's `id` or `prevId`; the chain is what `check-migrations.mjs` verifies. `CHANGELOG.md` merges with `merge=union`; keep each entry in its own dated section. Dependency or lockfile changes travel in their own small PR before feature work depends on them.
- Release identity: the build embeds the committed source tree hash, and `/api/deployment-health` and `/api/version` report it as `tree`. `scripts/parallel/release.sh` records GitHub SHA → tree in `docs/releases/` and can push an exact-tree projection of that revision to the Sites source (the Sites repository keeps its own history); `publish-sites.sh <sha>` is the owner-run Codex publication step; `verify-deploy.sh <sha>` confirms the running app reports that tree. Only that confirmation counts as a production deployment.

## Release boundary

- Product changes must reach GitHub `main` through a validated PR before the resulting source is published to Sites. Do not create a separate Sites-only development line.
- Publish from the exact verified merged GitHub source. If Sites assigns a different commit or version identifier, record its mapping to the GitHub SHA and verify that the application files match. Check for concurrent changes before publication.
- A GitHub merge is a source release, not a ChatGPT Sites deployment.
- Do not report production deployment until Sites publication and the authenticated production behavior are separately verified.
- The Android wrapper, Sites runtime, and GitHub source may have different versions; identify each explicitly when relevant.
- Repository instructions do not prove that a remote Slack/Hermes process has refreshed its checkout. Do not claim that its local configuration or running session was updated without verifying it.
