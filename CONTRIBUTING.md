# Contribution and release workflow

1. Describe one concrete user problem in an Issue, with acceptance criteria.
2. Create a short-lived `feat/...` or `fix/...` branch from `main`.
3. Implement only the agreed slice; keep the lockfile and existing toolchain.
4. Run `npm run typecheck`, `npm run test:planner`, `npm run test:storage`, `npm run test:notes`, `npm run build`, `npm run test:smoke`.
5. Open a PR describing the user behavior, evidence and any data migration.
6. Review, then enable auto-merge (`gh pr merge <n> --auto --merge`); `main` only accepts a PR whose head is up to date with `main` and green on `Validate Orbit`, so a PR that falls behind is re-synced and re-validated before it lands. Release the verified source version with `scripts/parallel/release.sh` and confirm it with `verify-deploy.sh`. Do not automatically publish from every PR.
7. For parallel work, one worktree per task: `scripts/parallel/start.sh <slug>` → develop → `sync.sh` → `finish.sh`. See `docs/Parallel_Loop.ko.md`.

For scheduling/approval or persistence changes, add a test only when it resolves a concrete risk. Do not mirror implementation with trivial tests or create tests for cosmetic edits.

Never commit real private records, personal account tokens, `.env`, `.wrangler`, database dumps or generated build output. Use synthetic fixtures. Runtime data belongs in the application's data store.

A UI rollback does not roll back database changes. Plan migrations and recovery explicitly. Model prompts are versioned code; input documents are user data. Preserve citation provenance and require explicit user confirmation of extracted records.
