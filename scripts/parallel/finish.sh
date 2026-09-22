#!/usr/bin/env bash
# Push the task branch, open (or update) its PR with the verified base and tree,
# then enable auto-merge (strict up-to-date + validate) and wait for the merged main SHA.
# usage: scripts/parallel/finish.sh [--title "..."] [--no-merge] [--skip-checks "<reason>"] [--wait-minutes N]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need gh

title=""; merge=1; skip_reason=""; wait_minutes=45
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --no-merge) merge=0; shift ;;
    --skip-checks) skip_reason="$2"; shift 2 ;;
    --wait-minutes) wait_minutes="$2"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) die "unexpected argument $1" ;;
  esac
done

cd "$(repo_root)"
branch="$(current_branch)"
[[ "${branch}" != "${ORBIT_MAIN_BRANCH}" && "${branch}" != "HEAD" ]] || die "run finish.sh inside a task worktree"
require_clean_tree
main="$(fetch_verified_main)"
git merge-base --is-ancestor "${main}" HEAD || die "${branch} does not contain ${ORBIT_MAIN_BRANCH} ${main}; run scripts/parallel/sync.sh first"

head="$(git rev-parse HEAD)"
tree="$(tree_of HEAD)"
node scripts/check-migrations.mjs --base "${main}"

if [[ -n "${skip_reason}" ]]; then
  log "skipping local checks: ${skip_reason} (CI still gates the merge)"
  checks="local checks skipped: ${skip_reason}"
elif [[ "$(task_read verified_head)" == "${head}" ]]; then
  log "reusing verification recorded for ${head} by sync.sh"
  checks="npm run typecheck, npm test passed on ${head} (sync.sh)"
else
  run_checks
  task_write "verified_head=${head}" "verified_tree=${tree}"
  checks="npm run typecheck, npm test passed on ${head}"
fi

log "pushing ${branch}"
git push --quiet -u "${ORBIT_REMOTE}" "${branch}"

body="$(cat <<BODY
## 해결하는 문제

$(git log --reverse --format='- %s' "${main}..HEAD")

## 검증

- 작업 시작 시 직접 확인한 GitHub \`main\` SHA: \`$(task_read base)\`
- 병합 직전 재확인한 \`${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH}\`: \`${main}\` (이 브랜치에 포함됨)
- PR head: \`${head}\` · 소스 tree: \`${tree}\`
- ${checks}
- \`scripts/check-migrations.mjs --base ${main}\`: 통과
- [ ] 현재 PR 코드의 \`Validate Orbit\` 성공 후 머지 큐 통과

## 데이터 / 연동 / 복구 영향

- Sites 배포 여부 / 배포했다면 GitHub SHA와 Sites 버전: 별도 release.sh 기록
BODY
)"

if pr_number="$(gh pr view "${branch}" -R "${ORBIT_GITHUB_REPO}" --json number --jq .number 2>/dev/null)" && [[ -n "${pr_number}" ]]; then
  log "updating PR #${pr_number}"
  gh pr edit "${pr_number}" -R "${ORBIT_GITHUB_REPO}" --body "${body}" >/dev/null
else
  [[ -n "${title}" ]] || title="$(git log -1 --format=%s)"
  pr_url="$(gh pr create -R "${ORBIT_GITHUB_REPO}" --base "${ORBIT_MAIN_BRANCH}" --head "${branch}" --title "${title}" --body "${body}")"
  pr_number="${pr_url##*/}"
  log "opened PR #${pr_number} ${pr_url}"
fi
task_write "pr=${pr_number}"

if [[ "${merge}" == 0 ]]; then
  log "PR #${pr_number} left open (--no-merge)"
  exit 0
fi

# Never enable auto-merge before the required check has passed on this head: if the
# ruleset were missing, GitHub would merge a "clean" PR immediately (PR #25 did).
wait_for_checks() {
  local pr="$1" tries=0 count
  while :; do
    count="$(gh pr checks "${pr}" -R "${ORBIT_GITHUB_REPO}" --json name --jq 'length' 2>/dev/null || printf 0)"
    [[ "${count}" =~ ^[0-9]+$ && "${count}" -gt 0 ]] && break
    (( tries++ < 18 )) || die "no checks reported for PR #${pr} after 3 minutes; is Validate Orbit configured for pull requests?"
    log "waiting for Validate Orbit to start on PR #${pr}"
    sleep 10
  done
  log "waiting for checks on PR #${pr} head $(git rev-parse --short HEAD)"
  gh pr checks "${pr}" -R "${ORBIT_GITHUB_REPO}" --watch --fail-fast --interval 15 >/dev/null \
    || die "checks failed on PR #${pr}; fix, commit and rerun finish.sh"
}
wait_for_checks "${pr_number}"
task_write "ci_passed_head=${head}"

# Auto-merge fires only when the head is up to date with main and validate is green.
# If another PR lands first, the PR becomes BEHIND and the loop below re-syncs it.
log "enabling auto-merge for PR #${pr_number} (merge commit)"
gh pr merge "${pr_number}" -R "${ORBIT_GITHUB_REPO}" --auto --merge >/dev/null

deadline=$(( $(date +%s) + wait_minutes * 60 ))
while :; do
  state="$(gh pr view "${pr_number}" -R "${ORBIT_GITHUB_REPO}" --json state,mergeCommit,mergeStateStatus --jq '[.state, (.mergeCommit.oid // ""), .mergeStateStatus] | join(" ")')"
  read -r pr_state merge_sha merge_state <<<"${state}"
  case "${pr_state}" in
    MERGED)
      merged_main="$(fetch_verified_main)"
      task_write "merged=${merge_sha}" "main_after=${merged_main}"
      cat >&2 <<MSG
[parallel] PR #${pr_number} merged
  merge commit  ${merge_sha}
  main now      ${merged_main}
  main tree     $(tree_of "${merged_main}")
This is a GitHub source release. Publish with scripts/parallel/release.sh and verify with verify-deploy.sh.
(If the PR was updated from ${ORBIT_MAIN_BRANCH} on GitHub, this worktree's branch is behind the merged branch; it was merged anyway.)
MSG
      exit 0 ;;
    CLOSED) die "PR #${pr_number} was closed without merging" ;;
  esac
  case "${merge_state}" in
    DIRTY) die "PR #${pr_number} conflicts with ${ORBIT_MAIN_BRANCH}; run scripts/parallel/sync.sh, then finish.sh again" ;;
    BEHIND)
      log "${ORBIT_MAIN_BRANCH} moved; updating PR #${pr_number} from ${ORBIT_MAIN_BRANCH} so CI re-runs on the combined head"
      gh pr update-branch "${pr_number}" -R "${ORBIT_GITHUB_REPO}" >/dev/null 2>&1 \
        || log "update-branch failed (conflict?); run scripts/parallel/sync.sh and finish.sh again" ;;
  esac
  [[ $(date +%s) -lt ${deadline} ]] || die "PR #${pr_number} not merged after ${wait_minutes} minutes (state ${merge_state}); check the queue with status.sh"
  log "waiting for queue/CI (state ${merge_state})"
  sleep 30
done
