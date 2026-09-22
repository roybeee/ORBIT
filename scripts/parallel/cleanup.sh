#!/usr/bin/env bash
# Remove worktrees whose branch is already part of origin/main.
# usage: scripts/parallel/cleanup.sh [--merged | <slug-or-branch>...] [--force]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

force=0; merged=0; targets=()
for arg in "$@"; do
  case "${arg}" in
    --force) force=1 ;;
    --merged) merged=1 ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) targets+=("${arg}") ;;
  esac
done
[[ ${merged} == 1 || ${#targets[@]} -gt 0 ]] || die "usage: cleanup.sh --merged | <slug-or-branch>..."

main="$(fetch_verified_main)"
main_root="$(main_worktree)"
here="$(repo_root)"

remove_worktree() {
  local path="$1" branch="$2"
  [[ "${path}" != "${main_root}" ]] || { log "skipping main checkout ${path}"; return; }
  [[ "${path}" != "${here}" ]] || die "cannot remove the worktree you are running from (${path}); run from another worktree"
  if [[ -n "$(git -C "${path}" status --porcelain 2>/dev/null)" && ${force} == 0 ]]; then
    log "skipping ${path}: uncommitted changes (use --force to discard)"; return
  fi
  if ! git merge-base --is-ancestor "${branch}" "${main}" 2>/dev/null && [[ ${force} == 0 ]]; then
    log "skipping ${path}: ${branch} is not merged into ${ORBIT_MAIN_BRANCH} (use --force)"; return
  fi
  log "removing worktree ${path} (${branch})"
  git worktree remove ${force:+--force} "${path}"
  git branch -D "${branch}" >/dev/null 2>&1 && log "deleted local branch ${branch}"
  if git ls-remote --exit-code --heads "${ORBIT_REMOTE}" "${branch}" >/dev/null 2>&1; then
    git push --quiet "${ORBIT_REMOTE}" --delete "${branch}" && log "deleted ${ORBIT_REMOTE}/${branch}"
  fi
}

git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); print p, $2}' | while read -r path branch; do
  [[ -n "${branch}" ]] || continue
  if [[ ${merged} == 1 ]]; then
    remove_worktree "${path}" "${branch}"
    continue
  fi
  for target in "${targets[@]}"; do
    if [[ "${branch}" == "${target}" || "${branch##*/}" == "${target}" || "$(basename "${path}")" == "${ORBIT_WORKTREE_PREFIX}${target}" ]]; then
      remove_worktree "${path}" "${branch}"
    fi
  done
done
git worktree prune
log "remaining worktrees:"; git worktree list >&2
