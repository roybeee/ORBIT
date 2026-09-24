# Hermes plugin: Slack instruction → Google + ORBIT

One Slack instruction registers everywhere it belongs:

| Instruction | Google | ORBIT |
|---|---|---|
| To-do (`orbit_slack_task`) | Google Tasks (`@default` list) | ORBIT task linked by `googleTask` (no extra Google Calendar reminder) |
| Memo (`orbit_slack_note`) | — | ORBIT knowledge note |
| Timed event | Created by Hermes in Google Calendar | Read by ORBIT from Google Calendar; `orbit_slack_directive_sync` only confirms this |

Project choice: the project the user named (or, with none named, a single clear keyword match) is used at once. A name matching several projects returns numbered candidates; the requester answers with a number and Hermes calls `orbit_slack_choose`. Nothing named and nothing matched goes to the `Slack 보관함` project.

Backend: `POST/GET /api/integrations/slack/commands` (`lib/orbit/slack/commands.ts`), authenticated with the existing `orbit_slack_credentials` key plus the Sites gate header. The Slack origin comes from the Hermes gateway ledger, never from model arguments; retries of the same message reuse one operation key, so neither Google nor ORBIT gets duplicates.

Settings on the Hermes host (already present for GoTEM): `ORBIT_SLACK_DIRECTIVE_URL`, `ORBIT_SLACK_INGEST_KEY`, `ORBIT_SLACK_SITES_BEARER`; Google token at `$HERMES_HOME/google_token.json` (or `ORBIT_SLACK_GOOGLE_TOKEN_FILE`) with the `tasks` scope.

Deploy after the backend is published: `integrations/hermes-orbit-commands/deploy.sh` (owner-run; backs up, tests on the server, restarts `hermes-gateway.service`). This supersedes `integrations/hermes-orbit-slack/`, which was never installed.
