# ORBIT Development Instructions

## Canonical source

- These instructions apply equally to work requested through Slack/Hermes, ChatGPT/Codex, Claude, and local development. Read this file from the freshly fetched `main` at the start of every task.
- The authoritative development source is the remote default branch `main` in `https://github.com/roybeee/ORBIT`.
- Before starting any work, fetch the remote and verify the exact current `origin/main` SHA. Do not rely on a cached local branch, an existing worktree name, or a previously reported SHA.
- Create every new work branch from the verified remote `main`.
- At the start of every task, read `docs/STATUS.md` and reconcile it with the live remote state (`origin/main` SHA, open PRs, `scripts/parallel/status.sh`). It is a memory aid, not evidence. When the state it describes changes, update it in the same PR (`scripts/parallel/status.sh --write` regenerates the auto section between the `status:auto` markers; the other sections are edited by hand).
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
- One task = one worktree from the verified remote `main`, and a worktree is never reused after its pull request merges. The helper scripts in `scripts/parallel/` implement this loop: `start.sh <slug>` (verified base + worktree + install), `sync.sh` (integrate the latest `main`, re-run checks), `finish.sh` (push, PR with base SHA and tree, wait for the required check, auto-merge, integrate `main` locally when behind, report the merged SHA), `status.sh` (drift and open-PR board), `cleanup.sh`, `release.sh`, `publish-sites.sh` and `verify-deploy.sh`. See `docs/Parallel_Loop.ko.md`.
- Conflict prevention: migrations are append-only and `scripts/check-migrations.mjs` runs in CI (journal indexes, files, snapshot chain, and no renumbering of migrations already on the base). If two branches generated the same number, the later one regenerates its migration on top of the integrated `main`: take `main`'s `drizzle/meta/` verbatim (`git checkout origin/main -- drizzle/meta/`), delete the draft `drizzle/NNNN_*.sql`, re-run `npm run db:generate`, and rename the generated file and its journal `tag` together if a descriptive name is wanted (snapshots are numbered, not named). Never hand-edit a snapshot's `id` or `prevId`; the chain is what `check-migrations.mjs` verifies. `CHANGELOG.md` merges with `merge=union`, which applies to local merges only — a `CHANGELOG.md` conflict on GitHub shows up as a `DIRTY` pull request and is resolved locally with `sync.sh`; keep each entry in its own dated section. Dependency or lockfile changes travel in their own small PR before feature work depends on them.
- Release identity: the build embeds the committed source tree hash, and `/api/deployment-health` and `/api/version` report it as `tree`. `scripts/parallel/release.sh` records GitHub SHA → tree in `docs/releases/` and can push an exact-tree projection of that revision to the Sites source (the Sites repository keeps its own history); `publish-sites.sh <sha>` is the owner-run Codex publication step; `verify-deploy.sh <sha>` confirms the running app reports that tree. Only that confirmation counts as a production deployment.

## State vocabulary

Use these words, and only these, when reporting where a change is. Never shorten "merged" to "deployed".

- Source: `merged` — the change is in GitHub `main` through a validated PR.
- Deploy: `published` — a Sites deployment of that exact tree reported `succeeded` (deployment id recorded in `docs/releases/`); `runtime-verified` — the running app reported the same `tree` (`verify-deploy.sh`, or an authenticated `/api/version` read recorded with its output).
- Each check: `passed | failed | blocked | not_run`, plus `real` or `mocked`. A check is `mocked` when it replaces the thing it is named after (for example, tests that stub the OpenAI `fetch` are `mocked` for model behavior). `not_run` and `blocked` always carry a reason.

## Delegation contract

Background: on 2026-09-22 the Hermes hub looped for about two hours (about 90 delegations, 20+ timeouts at `child_timeout_seconds` 600, quality gates added by the agents themselves, and `main` moving underneath). Every delegated task — Slack/Hermes, Claude, Codex or human — must state, before work starts:

1. Goal and observable acceptance criteria, including the failure cases that must be handled.
2. Owned files or subsystem, and the shared interfaces it must not change without the owner.
3. Branch and worktree (one task = one worktree from the verified `main`).
4. Time budget and the maximum number of re-delegations. Default: one re-delegation; after that, escalate to the owner in #승인함 instead of retrying.
5. The allowed quality gates. Only the delegating owner defines gates; no agent adds new gates on its own.
6. The tests that must be added or run, with their state per the vocabulary above.
7. The result-return path: commit SHA (or PR) plus test evidence (commands and pass/fail counts). A self-reported "done" without these is not a result.

## Release boundary

- Product changes must reach GitHub `main` through a validated PR before the resulting source is published to Sites. Do not create a separate Sites-only development line.
- Publish from the exact verified merged GitHub source. If Sites assigns a different commit or version identifier, record its mapping to the GitHub SHA and verify that the application files match. Check for concurrent changes before publication.
- A GitHub merge is a source release, not a ChatGPT Sites deployment.
- Do not report production deployment until Sites publication and the authenticated production behavior are separately verified.
- The Android wrapper, Sites runtime, and GitHub source may have different versions; identify each explicitly when relevant.
- `publish-sites.sh` runs `scripts/parallel/preflight-quota.mjs` first. It blocks when Codex and Hermes share one OpenAI account (a publication spends the Hermes weekly quota) or when a Hermes credential has a quota error (429/quota) with a future or missing reset time; a stored `relogin_required` flag only warns. Pass `--accept-shared-quota` only when the owner accepts that cost for this run. After a publication, the Codex report is archived in `docs/releases/publish-reports/`; `cleanup.sh --publish-clones` removes leftover publish clones whose only change is that report.
- Repository instructions do not prove that a remote Slack/Hermes process has refreshed its checkout. Do not claim that its local configuration or running session was updated without verifying it.
