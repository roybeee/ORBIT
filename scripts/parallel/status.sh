#!/usr/bin/env bash
# One board for every parallel task: drift from main, dirty files, open PR and CI.
# usage: scripts/parallel/status.sh [--write]
#   --write regenerates the block between the status:auto markers in docs/STATUS.md
#   (main SHA, tree, worktrees, open PRs) and leaves the hand-written sections alone.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

write=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --write) write=1; shift ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) die "unexpected argument $1" ;;
  esac
done

main="$(fetch_verified_main)"

if [[ ${write} == 1 ]]; then
  status_file="$(repo_root)/docs/STATUS.md"
  start_marker='<!-- status:auto:start -->'; end_marker='<!-- status:auto:end -->'
  [[ -f "${status_file}" ]] || die "${status_file} does not exist"
  grep -qxF "${start_marker}" "${status_file}" && grep -qxF "${end_marker}" "${status_file}" \
    || die "${status_file} lacks the ${start_marker} / ${end_marker} lines"
  block="$(mktemp)"; next="$(mktemp)"
  trap 'rm -f "${block}" "${next}"' EXIT
  {
    printf '_`scripts/parallel/status.sh --write`가 생성한 구역입니다. 손으로 고치지 마세요._\n\n'
    printf -- '- 생성 시각(UTC): %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf -- '- `%s/%s`: `%s` (GitHub `ls-remote`와 일치 확인)\n' "${ORBIT_REMOTE}" "${ORBIT_MAIN_BRANCH}" "${main}"
    printf -- '- 소스 tree: `%s`\n\n' "$(tree_of "${main}")"
    printf '### 워크트리 (이 머신)\n\n| 워크트리 | 브랜치 | HEAD | main 대비 뒤/앞 | 미커밋 |\n|---|---|---|---|---|\n'
    git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r path; do
      printf '| %s | %s | `%s` | %s / %s | %s |\n' "$(basename "${path}")" \
        "$(git -C "${path}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')" \
        "$(git -C "${path}" rev-parse --short HEAD 2>/dev/null || echo '?')" \
        "$(git -C "${path}" rev-list --count "HEAD..${main}" 2>/dev/null || echo '?')" \
        "$(git -C "${path}" rev-list --count "${main}..HEAD" 2>/dev/null || echo '?')" \
        "$([[ -n "$(git -C "${path}" status --porcelain --untracked-files=no 2>/dev/null)" ]] && echo yes || echo no)"
    done
    printf '\n### 열린 PR\n\n'
    if command -v gh >/dev/null 2>&1; then
      prs="$(gh pr list -R "${ORBIT_GITHUB_REPO}" --state open --json number,title,headRefName,mergeStateStatus \
        --jq '.[] | "- #\(.number) `\(.headRefName)` \(.mergeStateStatus) — \(.title)"' 2>/dev/null)" || prs="- (gh pr list failed)"
      printf '%s\n' "${prs:-- 없음}"
    else
      printf -- '- (gh 없음, 확인 불가)\n'
    fi
  } >"${block}"
  # Everything outside the markers is copied through untouched.
  awk -v block="${block}" -v start="${start_marker}" -v end="${end_marker}" '
    $0 == start { print; while ((getline line < block) > 0) print line; skipping = 1; next }
    $0 == end { skipping = 0 }
    !skipping { print }
  ' "${status_file}" >"${next}"
  cat "${next}" >"${status_file}"
  log "updated the auto section of ${status_file}; review and commit it"
  exit 0
fi
printf 'main  %s  tree %s\n\n' "${main}" "$(short "$(tree_of "${main}")")"
printf '%-24s %-38s %-8s %-6s %-6s %-5s %-12s %s\n' WORKTREE BRANCH HEAD BEHIND AHEAD DIRTY PR CI/MERGE

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r path; do
  branch="$(git -C "${path}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  head="$(git -C "${path}" rev-parse --short HEAD 2>/dev/null || echo '?')"
  behind="$(git -C "${path}" rev-list --count "HEAD..${main}" 2>/dev/null || echo '?')"
  ahead="$(git -C "${path}" rev-list --count "${main}..HEAD" 2>/dev/null || echo '?')"
  dirty="$([[ -n "$(git -C "${path}" status --porcelain --untracked-files=no 2>/dev/null)" ]] && echo yes || echo no)"
  pr="-"; ci="-"
  if [[ "${branch}" != "${ORBIT_MAIN_BRANCH}" && "${branch}" != "HEAD" ]] && command -v gh >/dev/null 2>&1; then
    # --head + --state open, because `gh pr view <branch>` falls back to a MERGED
    # pull request and would report a finished one as this worktree's state.
    info="$(gh pr list -R "${ORBIT_GITHUB_REPO}" --head "${branch}" --state open --limit 1 --json number,state,mergeStateStatus,autoMergeRequest,statusCheckRollup \
      --jq '.[0] | select(.) | "\(.number) \(.state) \(.mergeStateStatus) \(if .autoMergeRequest then "auto" else "-" end) \(([.statusCheckRollup[]? | select(.name=="validate" or .context=="validate") | (.conclusion // .state // "pending")] | map(select(. != "")) | first) // "none")"' 2>/dev/null || true)"
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
