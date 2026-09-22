#!/usr/bin/env bash
# Start one isolated task: verified origin/main -> new branch -> new worktree.
# usage: scripts/parallel/start.sh <slug> [--type feat|fix|refactor|docs|chore] [--no-install]
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

slug=""; type="feat"; install=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) type="$2"; shift 2 ;;
    --no-install) install=0; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) [[ -z "${slug}" ]] || die "unexpected argument $1"; slug="$1"; shift ;;
  esac
done
[[ -n "${slug}" ]] || die "usage: start.sh <slug> [--type feat|fix|refactor|docs|chore]"
[[ "${slug}" =~ ^[a-z0-9][a-z0-9-]{1,48}$ ]] || die "slug must be lowercase letters, digits and dashes"
[[ "${type}" =~ ^(feat|fix|refactor|docs|chore)$ ]] || die "--type must be feat|fix|refactor|docs|chore"

branch="${type}/${slug}"
base="$(fetch_verified_main)"
main_root="$(main_worktree)"
dir="$(dirname "${main_root}")/${ORBIT_WORKTREE_PREFIX}${slug}"

[[ ! -e "${dir}" ]] || die "${dir} already exists; pick another slug or run cleanup.sh"
if git show-ref --verify --quiet "refs/heads/${branch}"; then
  die "branch ${branch} already exists locally; continue it with: git worktree add ${dir} ${branch}"
fi
if git ls-remote --exit-code --heads "${ORBIT_REMOTE}" "${branch}" >/dev/null 2>&1; then
  die "branch ${branch} already exists on ${ORBIT_REMOTE}; pick another slug"
fi

log "base ${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH} = ${base} (verified against GitHub)"
git worktree add --quiet -b "${branch}" "${dir}" "${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH}"
git -C "${dir}" branch --quiet --set-upstream-to="${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH}" "${branch}" 2>/dev/null || true

(
  cd "${dir}"
  task_write "slug=${slug}" "branch=${branch}" "base=${base}" "base_tree=$(tree_of "${base}")" "created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ "${install}" == 1 ]]; then
    log "installing dependencies in ${dir} (npm ci)"
    npm ci --no-audit --no-fund
  fi
)

cat >&2 <<MSG

[parallel] worktree ready
  path    ${dir}
  branch  ${branch}
  base    ${base}

next
  cd ${dir}
  # develop, commit
  scripts/parallel/sync.sh      # pull the latest main into this branch and re-run checks
  scripts/parallel/finish.sh    # push, open the PR and enter the merge queue
MSG
