#!/usr/bin/env bash
# Remove worktrees whose branch is already part of origin/main, and leftover
# standalone Sites publish clones whose report has been archived.
# usage: scripts/parallel/cleanup.sh [--merged | <slug-or-branch>...] [--publish-clones] [--force]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

force=0; merged=0; publish_clones=0; targets=()
for arg in "$@"; do
  case "${arg}" in
    --force) force=1 ;;
    --merged) merged=1 ;;
    --publish-clones) publish_clones=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) targets+=("${arg}") ;;
  esac
done
[[ ${merged} == 1 || ${publish_clones} == 1 || ${#targets[@]} -gt 0 ]] || die "usage: cleanup.sh --merged | <slug-or-branch>... | --publish-clones"

main="$(fetch_verified_main)"
main_root="$(main_worktree)"
here="$(repo_root)"

remove_worktree() {
  local path="$1" branch="$2"
  [[ "${path}" != "${main_root}" ]] || { log "skipping main checkout ${path}"; return; }
  [[ "${path}" != "${here}" ]] || { log "skipping ${path}: it is the worktree you are running from"; return; }
  if [[ -n "$(git -C "${path}" status --porcelain 2>/dev/null)" && ${force} == 0 ]]; then
    log "skipping ${path}: uncommitted changes (use --force to discard)"; return
  fi
  # "Merged" means the branch contributed commits that are now in main. `git
  # merge-base --is-ancestor X X` is reflexive, so a branch still sitting exactly
  # where start.sh created it looks merged — and a worktree whose only files are
  # ignored (node_modules, .orbit-task.json) also looks clean. Removing that pair
  # destroys another agent's freshly started task, so require real contributed
  # history before touching anything.
  if [[ ${force} == 0 ]]; then
    if ! git merge-base --is-ancestor "${branch}" "${main}" 2>/dev/null; then
      log "skipping ${path}: ${branch} is not merged into ${ORBIT_MAIN_BRANCH} (use --force)"; return
    fi
    if [[ "$(git rev-parse "${branch}")" == "${main}" ]]; then
      log "skipping ${path}: ${branch} is still at ${ORBIT_MAIN_BRANCH}; it has no work of its own (another agent may be starting)"; return
    fi
    if [[ "$(task_read_at "${path}" merged)" == "" && "$(pr_state_of "${branch}")" != "MERGED" ]]; then
      log "skipping ${path}: no merged PR recorded for ${branch}; it may still be in flight (use --force)"; return
    fi
  fi
  log "removing worktree ${path} (${branch})"
  if [[ ${force} == 1 ]]; then
    git worktree remove --force "${path}"
  else
    git worktree remove "${path}"
  fi
  git branch -D "${branch}" >/dev/null 2>&1 && log "deleted local branch ${branch}"
  if git ls-remote --exit-code --heads "${ORBIT_REMOTE}" "${branch}" >/dev/null 2>&1; then
    git push --quiet "${ORBIT_REMOTE}" --delete "${branch}" && log "deleted ${ORBIT_REMOTE}/${branch}"
  fi
}

# publish-sites.sh leaves standalone clones (${ORBIT_WORKTREE_PREFIX}publish-<sha7>, own .git
# directory, ~1 GB with node_modules) next to the main worktree. A clone whose only
# change is the Codex report is disposable once that report is archived into this
# worktree's docs/releases/publish-reports/. Anything else it carries may be the
# only copy of an edit made during publication, so it stays unless --force.
remove_publish_clones() {
  local dest="${here}/docs/releases/publish-reports" clone status others report sha7
  for clone in "$(dirname "${main_root}")/${ORBIT_WORKTREE_PREFIX}"publish-*; do
    [[ -e "${clone}" ]] || continue
    if [[ ! -d "${clone}/.git" ]]; then
      log "skipping ${clone}: not a standalone clone (a worktree is removed with <slug> or --merged)"; continue
    fi
    if ! status="$(git -C "${clone}" status --porcelain 2>&1)"; then
      log "skipping ${clone}: git status failed: ${status}"; continue
    fi
    others="$(grep -vxF '?? .sites-publish-result.md' <<<"${status}" | sed '/^$/d' || true)"
    if [[ -n "${others}" && ${force} == 0 ]]; then
      log "skipping ${clone}: modified beyond the publish report (use --force to discard):"; printf '%s\n' "${others}" >&2; continue
    fi
    report="${clone}/.sites-publish-result.md"
    if [[ -s "${report}" ]]; then
      sha7="$(short "$(git -C "${clone}" rev-parse HEAD)")"
      mkdir -p "${dest}"
      if [[ -f "${dest}/${sha7}.md" ]] && ! cmp -s "${report}" "${dest}/${sha7}.md"; then
        log "skipping ${clone}: ${dest}/${sha7}.md already exists with different content; reconcile it by hand"; continue
      fi
      cp "${report}" "${dest}/${sha7}.md"
      log "archived ${report} -> ${dest}/${sha7}.md"
    elif [[ ${force} == 0 ]]; then
      log "skipping ${clone}: no publish report to archive (use --force to remove anyway)"; continue
    fi
    rm -rf "${clone}"
    log "removed publish clone ${clone}"
  done
}
[[ ${publish_clones} == 0 ]] || remove_publish_clones
# --publish-clones alone touches no worktree (and bash 3.2 treats the empty
# targets array below as unbound under set -u).
[[ ${merged} == 1 || ${#targets[@]} -gt 0 ]] || exit 0

# Process substitution, not a pipe: a pipeline would run this loop in a subshell,
# where `die` could not stop the run and nothing it set would survive.
while read -r path branch; do
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
done < <(git worktree list --porcelain | awk '/^worktree /{p=$2} /^branch /{sub("refs/heads/","",$2); print p, $2}')
git worktree prune
log "remaining worktrees:"; git worktree list >&2
