# Contribution and release workflow

1. Describe one concrete user problem in an Issue, with acceptance criteria.
2. Create a short-lived `feat/...` or `fix/...` branch from `main`.
3. Implement only the agreed slice; keep the lockfile and existing toolchain.
4. Run `npm run typecheck`, `npm run test:planner`, `npm run test:storage`, `npm run test:notes`, `npm run build`, `npm run test:smoke`.
5. Open a PR describing the user behavior, evidence and any data migration.
6. Review and merge, then release the verified source version. Do not automatically publish from every PR.

For scheduling/approval or persistence changes, add a test only when it resolves a concrete risk. Do not mirror implementation with trivial tests or create tests for cosmetic edits.

Never commit real private records, personal account tokens, `.env`, `.wrangler`, database dumps or generated build output. Use synthetic fixtures. Runtime data belongs in the application's data store.

A UI rollback does not roll back database changes. Plan migrations and recovery explicitly. Model prompts are versioned code; input documents are user data. Preserve citation provenance and require explicit user confirmation of extracted records.
