#!/usr/bin/env bash
# Reconcile this worktree with the latest verified origin/main and re-run checks.
# usage: scripts/parallel/sync.sh [--rebase] [--no-verify]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

mode="merge"; verify=1
for arg in "$@"; do
  case "${arg}" in
    --rebase) mode="rebase" ;;
    --no-verify) verify=0 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "unexpected argument ${arg}" ;;
  esac
done

cd "$(repo_root)"
branch="$(current_branch)"
[[ "${branch}" != "${ORBIT_MAIN_BRANCH}" && "${branch}" != "HEAD" ]] || die "run sync.sh inside a task worktree, not on ${branch}"
require_clean_tree
main="$(fetch_verified_main)"

if git merge-base --is-ancestor "${main}" HEAD; then
  log "${branch} already contains ${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH} ${main}"
else
  behind="$(git rev-list --count "HEAD..${main}")"
  log "${branch} is ${behind} commit(s) behind ${ORBIT_MAIN_BRANCH}; integrating with ${mode}"
  if [[ "${mode}" == "rebase" ]]; then
    git rebase "${main}" || die "rebase stopped on conflicts; resolve, 'git rebase --continue', then rerun sync.sh"
  else
    git merge --no-edit "${main}" || die "merge stopped on conflicts; resolve, commit, then rerun sync.sh"
  fi
fi

# Journal conflicts are the common parallel failure; check before spending time on the build.
node scripts/check-migrations.mjs --base "${main}"

if [[ "${verify}" == 1 ]]; then
  run_checks
  task_write "synced_main=${main}" "verified_head=$(git rev-parse HEAD)" "verified_tree=$(tree_of HEAD)"
  log "verified $(git rev-parse HEAD) on top of ${ORBIT_MAIN_BRANCH} ${main}"
else
  task_write "synced_main=${main}"
  log "synced without verification (--no-verify); run checks before finish.sh"
fi
