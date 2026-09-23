# Release records

One file per source release: `YYYY-MM-DD-<sha7>.md`, created by `scripts/parallel/release.sh`.
Each record maps the GitHub `main` SHA to its source tree hash, the Validate Orbit run,
the Sites source push, the Sites version/deployment id and the `verify-deploy.sh` result.
The tree hash is what the running app reports at `/api/deployment-health`, so a record is
complete only when the verified running tree equals the GitHub tree.

`publish-reports/<sha7>.md` holds the raw Codex report (`GITHUB_SHA`, `TREE`, `SITES_COMMIT`,
`SITES_VERSION`, `DEPLOYMENT_ID`, `DEPLOYMENT_STATUS`, `NOTES`) of each `publish-sites.sh` run,
archived by `publish-sites.sh` or `cleanup.sh --publish-clones` before the publish clone is deleted.
