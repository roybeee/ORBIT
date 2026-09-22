#!/usr/bin/env bash
# One board for every parallel task: drift from main, dirty files, PR, CI and queue.
# usage: scripts/parallel/status.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

main="$(fetch_verified_main)"
printf 'main  %s  tree %s\n\n' "${main}" "$(short "$(tree_of "${main}")")"
printf '%-24s %-38s %-8s %-6s %-6s %-5s %-12s %s\n' WORKTREE BRANCH HEAD BEHIND AHEAD DIRTY PR CI/QUEUE

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r path; do
  branch="$(git -C "${path}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  head="$(git -C "${path}" rev-parse --short HEAD 2>/dev/null || echo '?')"
  behind="$(git -C "${path}" rev-list --count "HEAD..${main}" 2>/dev/null || echo '?')"
  ahead="$(git -C "${path}" rev-list --count "${main}..HEAD" 2>/dev/null || echo '?')"
  dirty="$([[ -n "$(git -C "${path}" status --porcelain --untracked-files=no 2>/dev/null)" ]] && echo yes || echo no)"
  pr="-"; ci="-"
  if [[ "${branch}" != "${ORBIT_MAIN_BRANCH}" && "${branch}" != "HEAD" ]] && command -v gh >/dev/null 2>&1; then
    info="$(gh pr view "${branch}" -R "${ORBIT_GITHUB_REPO}" --json number,state,mergeStateStatus,autoMergeRequest,statusCheckRollup \
      --jq '"\(.number) \(.state) \(.mergeStateStatus) \(if .autoMergeRequest then "queued" else "-" end) \(([.statusCheckRollup[]? | select(.name=="validate" or .context=="validate") | (.conclusion // .state // "pending")] | first) // "none")' 2>/dev/null || true)"
    if [[ -n "${info}" ]]; then
      read -r number state merge_state queued check <<<"${info}"
      pr="#${number}:${state}"
      ci="${check}/${merge_state}${queued:+ ${queued}}"
    fi
  fi
  printf '%-24s %-38s %-8s %-6s %-6s %-5s %-12s %s\n' "$(basename "${path}")" "${branch}" "${head}" "${behind}" "${ahead}" "${dirty}" "${pr}" "${ci}"
done

if command -v gh >/dev/null 2>&1; then
  owner="${ORBIT_GITHUB_REPO%/*}"; name="${ORBIT_GITHUB_REPO#*/}"
  queue="$(gh api graphql -f query="{repository(owner:\"${owner}\",name:\"${name}\"){mergeQueue(branch:\"${ORBIT_MAIN_BRANCH}\"){entries(first:20){nodes{position state pullRequest{number title}}}}}}" \
    --jq '.data.repository.mergeQueue.entries.nodes[]? | "  \(.position). PR #\(.pullRequest.number) \(.state) — \(.pullRequest.title)"' 2>/dev/null || true)"
  printf '\nmerge queue (%s)\n%s\n' "${ORBIT_MAIN_BRANCH}" "${queue:-  none (personal repositories have no merge queue; auto-merge + strict up-to-date checks gate main)}"
fi
