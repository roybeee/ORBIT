#!/usr/bin/env bash
# Idempotently configure roybeee/ORBIT so parallel PRs integrate safely:
#   repository: delete merged branches, allow auto-merge, allow "update branch"
#   ruleset "main-integration": PR required (merge commits only), Validate Orbit
#   `validate` required on a head that is up to date with main (strict), no
#   deletion, no force-push, no bypass for anyone. Owner intervention = edit the ruleset.
# GitHub merge queues exist only for organization-owned repositories, so this
# personal repository relies on strict up-to-date checks + auto-merge instead;
# finish.sh re-syncs a PR that falls behind. Pass --merge-queue after moving the
# repository into an organization to switch to a real queue.
# usage: scripts/parallel/github-setup.sh [--dry-run] [--remove] [--enforcement active|disabled] [--merge-queue]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need gh

dry_run=0; remove=0; enforcement="active"; merge_queue=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1; shift ;;
    --remove) remove=1; shift ;;
    --enforcement) enforcement="$2"; shift 2 ;;
    --merge-queue) merge_queue=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unexpected argument $1" ;;
  esac
done
[[ "${enforcement}" =~ ^(active|disabled)$ ]] || die "--enforcement must be active or disabled"

ruleset_name="main-integration"
if [[ ${merge_queue} == 1 ]]; then
  strict="false"   # the queue itself builds main + PR, so up-to-date is not needed
  queue_rule=',
    {"type": "merge_queue", "parameters": {
      "merge_method": "MERGE",
      "grouping_strategy": "ALLGREEN",
      "min_entries_to_merge": 1,
      "max_entries_to_merge": 5,
      "max_entries_to_build": 5,
      "min_entries_to_merge_wait_minutes": 0,
      "check_response_timeout_minutes": 30
    }}'
else
  strict="true"    # the checked head must already contain the current main
  queue_rule=''
fi
ruleset_json="$(cat <<JSON
{
  "name": "${ruleset_name}",
  "target": "branch",
  "enforcement": "${enforcement}",
  "bypass_actors": [],
  "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false,
      "require_extra_approval_for_unattributed_changes": false,
      "allowed_merge_methods": ["merge"]
    }},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": ${strict},
      "do_not_enforce_on_create": false,
      "required_status_checks": [{"context": "${ORBIT_CI_CHECK}"}]
    }}${queue_rule}
  ]
}
JSON
)"

repo_settings='{"delete_branch_on_merge": true, "allow_auto_merge": true, "allow_update_branch": true, "allow_merge_commit": true}'

existing_id="$(gh api "repos/${ORBIT_GITHUB_REPO}/rulesets" --jq ".[] | select(.name==\"${ruleset_name}\") | .id" 2>/dev/null || true)"

if [[ ${remove} == 1 ]]; then
  [[ -n "${existing_id}" ]] || die "ruleset ${ruleset_name} does not exist"
  if [[ ${dry_run} == 1 ]]; then log "would delete ruleset ${ruleset_name} (#${existing_id})"; exit 0; fi
  gh api -X DELETE "repos/${ORBIT_GITHUB_REPO}/rulesets/${existing_id}" >/dev/null
  log "deleted ruleset ${ruleset_name}; main is unprotected again"
  exit 0
fi

if [[ ${dry_run} == 1 ]]; then
  log "would PATCH repos/${ORBIT_GITHUB_REPO} with: ${repo_settings}"
  log "would $([[ -n "${existing_id}" ]] && echo "PUT rulesets/${existing_id}" || echo "POST rulesets") with:"
  printf '%s\n' "${ruleset_json}"
  exit 0
fi

log "updating repository merge settings"
gh api -X PATCH "repos/${ORBIT_GITHUB_REPO}" --input - <<<"${repo_settings}" \
  --jq '{delete_branch_on_merge, allow_auto_merge, allow_update_branch, allow_merge_commit}'

if [[ -n "${existing_id}" ]]; then
  log "updating ruleset ${ruleset_name} (#${existing_id})"
  gh api -X PUT "repos/${ORBIT_GITHUB_REPO}/rulesets/${existing_id}" --input - <<<"${ruleset_json}" --jq '{id, name, enforcement, rules: [.rules[].type]}'
else
  log "creating ruleset ${ruleset_name}"
  gh api -X POST "repos/${ORBIT_GITHUB_REPO}/rulesets" --input - <<<"${ruleset_json}" --jq '{id, name, enforcement, rules: [.rules[].type]}'
fi
if [[ "${enforcement}" == "active" ]]; then
  if [[ ${merge_queue} == 1 ]]; then
    log "done. Merges into ${ORBIT_MAIN_BRANCH} go through the merge queue; CI must run on merge_group events."
  else
    log "done. Merges into ${ORBIT_MAIN_BRANCH} require a PR whose head is up to date with ${ORBIT_MAIN_BRANCH} and green on ${ORBIT_CI_CHECK}."
  fi
else
  log "done. Ruleset saved but disabled; rerun with --enforcement active to enforce it."
fi
