#!/usr/bin/env bash
# GoTEM Slack message from stored ORBIT state (no model call). Prints the message text for a Hermes
# `no_agent` cron job; prints nothing when ORBIT decides to stay silent (skipped or already sent).
# usage: gotem.sh morning|afternoon|night
set -euo pipefail
slot="${1:-}"
case "${slot}" in morning|afternoon|night) ;; *) echo "usage: gotem.sh morning|afternoon|night" >&2; exit 2 ;; esac
: "${ORBIT_SLACK_INGEST_KEY:?ORBIT_SLACK_INGEST_KEY is not set}"
url="${ORBIT_GOTEM_URL:-}"
if [[ -z "${url}" ]]; then
  : "${ORBIT_SLACK_DIRECTIVE_URL:?set ORBIT_GOTEM_URL or ORBIT_SLACK_DIRECTIVE_URL}"
  url="${ORBIT_SLACK_DIRECTIVE_URL%/directives}/gotem"
fi
headers=(-H "authorization: Bearer ${ORBIT_SLACK_INGEST_KEY}" -H "content-type: application/json")
if [[ -n "${ORBIT_SLACK_SITES_BEARER:-}" ]]; then headers+=(-H "OAI-Sites-Authorization: Bearer ${ORBIT_SLACK_SITES_BEARER}"); fi
body="$(curl -fsS --max-time 30 -X POST "${url}" "${headers[@]}" --data "{\"slot\":\"${slot}\"}")"
printf '%s' "${body}" | python3 -c 'import json,sys
m=json.load(sys.stdin)
if m.get("send"): print(m["text"])'
