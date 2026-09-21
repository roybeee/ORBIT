# ORBIT Development Instructions

## Canonical source

- The authoritative development source is the remote default branch `main` in `https://github.com/roybeee/ORBIT`.
- Before starting any work, fetch the remote and verify the exact current `origin/main` SHA. Do not rely on a cached local branch, an existing worktree name, or a previously reported SHA.
- Create every new work branch from the verified remote `main`.
- `archive/main-76769c8` is preserved historical reference only. Do not branch from it, merge it wholesale, or treat it as the current product unless the owner explicitly reverses this decision.

## Development workflow

1. Run `git fetch origin --prune`.
2. Confirm `git rev-parse origin/main` matches `git ls-remote origin refs/heads/main`.
3. Start a new feature or fix branch from `origin/main`.
4. Keep migrations append-only from the current `main`; never reuse a migration number from an archived or stale branch.
5. Run `npm run typecheck` and `npm test` before opening or merging a pull request.
6. Merge only after `Validate Orbit` succeeds, then read back the remote `main` SHA.

## Release boundary

- A GitHub merge is a source release, not a ChatGPT Sites deployment.
- Do not report production deployment until Sites publication and the authenticated production behavior are separately verified.
- The Android wrapper, Sites runtime, and GitHub source may have different versions; identify each explicitly when relevant.
