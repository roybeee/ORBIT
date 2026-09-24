# Hermes GoTEM scripts

These scripts replace the three LLM-prompt GoTEM cron jobs in #비서실 (`C0B31KPEB61`) with `no_agent` script jobs. Each job prints the message that ORBIT composed from its stored state. The cron runs no model: ORBIT decides the text, and an empty print means Hermes posts nothing.

| Job (current id) | Schedule (KST) | Script |
|---|---|---|
| GoTEM 아침 계획 (`520b073d290c`) | `0 9 * * *` | `gotem-morning.sh` |
| GoTEM 오후 리셋 (`0794a24119f2`) | `0 14 * * *` | `gotem-afternoon.sh` |
| GoTEM 밤 PAFI 피드백 (`5a5037e96f1c`) | `30 22 * * *` | `gotem-night.sh` |

Hermes resolves `script` inside `~/.hermes/scripts`, runs `.sh` with bash and passes no arguments, so each slot has its own one-line wrapper around `gotem.sh`.

## Environment

The scripts read the same values the Slack directive plugin already uses from `~/.hermes/.env`. `no_agent` jobs reload `.env` on every run.

| Variable | Purpose |
|---|---|
| `ORBIT_SLACK_INGEST_KEY` | Bearer token for the provisioned `orbit_slack_credentials` row (`directives:write`). The route takes the owner from that row. |
| `ORBIT_SLACK_DIRECTIVE_URL` | `…/api/integrations/slack/directives`. The script replaces the last segment with `/gotem`. You can also set `ORBIT_GOTEM_URL` explicitly. |
| `ORBIT_SLACK_SITES_BEARER` | Optional. Sent as `OAI-Sites-Authorization` to pass the Sites gate. |

## Check before switching

Preview is read-only and does not claim the day's slot:

```bash
source ~/.hermes/.env
curl -fsS "${ORBIT_SLACK_DIRECTIVE_URL%/directives}/gotem?slot=morning" \
  -H "authorization: Bearer ${ORBIT_SLACK_INGEST_KEY}" \
  -H "OAI-Sites-Authorization: Bearer ${ORBIT_SLACK_SITES_BEARER}"
```

Do not run the scripts by hand to test. A POST claims the slot for the day, and that day's cron run then stays silent.

## Install (owner-approved step, not done by the PR)

1. Back up the current jobs: `cp ~/.hermes/cron/jobs.json ~/.hermes/cron/jobs.json.bak-gotem-$(date +%Y%m%d-%H%M%S)`.
2. Copy `gotem.sh` and the three wrappers to `~/.hermes/scripts/`, then run `chmod +x`.
3. For each job, set `script` to the wrapper name, `no_agent` to `true`, and keep `deliver: slack:C0B31KPEB61`. Leave the prompt text in the backup only.

If a script fails (network error or HTTP error from ORBIT), it exits non-zero, and Hermes records the run as an error instead of posting a guessed message.

## Rollback

Restore the backup `jobs.json`. The ORBIT route can stay deployed: without the cron calling it, it does nothing.
