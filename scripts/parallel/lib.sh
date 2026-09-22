#!/usr/bin/env bash
# Shared helpers for the ORBIT parallel work loop. Source, do not execute.
# Every script verifies the GitHub remote and the exact origin/main SHA before
# acting, as AGENTS.md requires, so no worktree ever starts from stale state.
set -euo pipefail

ORBIT_REMOTE="${ORBIT_REMOTE:-origin}"
ORBIT_GITHUB_REPO="${ORBIT_GITHUB_REPO:-roybeee/ORBIT}"
ORBIT_MAIN_BRANCH="${ORBIT_MAIN_BRANCH:-main}"
ORBIT_WORKTREE_PREFIX="${ORBIT_WORKTREE_PREFIX:-orbit-}"
ORBIT_TASK_FILE=".orbit-task.json"
ORBIT_CI_WORKFLOW="${ORBIT_CI_WORKFLOW:-ci.yml}"
ORBIT_CI_CHECK="${ORBIT_CI_CHECK:-validate}"

log() { printf '[parallel] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }

repo_root() { git rev-parse --show-toplevel; }

# The first worktree in the porcelain list is the main checkout that owns .git.
main_worktree() { git worktree list --porcelain | awk '/^worktree /{print $2; exit}'; }

verify_remote() {
  local url
  url="$(git remote get-url "${ORBIT_REMOTE}" 2>/dev/null)" || die "remote ${ORBIT_REMOTE} is not configured"
  case "${url}" in
    *"github.com/${ORBIT_GITHUB_REPO}"*|*"github.com:${ORBIT_GITHUB_REPO}"*) ;;
    *) die "remote ${ORBIT_REMOTE} points to ${url}, not github.com/${ORBIT_GITHUB_REPO}" ;;
  esac
}

# Fetches, then proves the local origin/main ref equals the live GitHub head.
fetch_verified_main() {
  verify_remote
  git fetch "${ORBIT_REMOTE}" --prune --quiet
  local local_sha remote_sha
  local_sha="$(git rev-parse "${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH}")"
  remote_sha="$(git ls-remote "${ORBIT_REMOTE}" "refs/heads/${ORBIT_MAIN_BRANCH}" | cut -f1)"
  [[ -n "${remote_sha}" ]] || die "could not read refs/heads/${ORBIT_MAIN_BRANCH} from ${ORBIT_REMOTE}"
  [[ "${local_sha}" == "${remote_sha}" ]] || die "${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH} ${local_sha} differs from live ${remote_sha}; fetch again"
  printf '%s\n' "${local_sha}"
}

tree_of() { git rev-parse "$1^{tree}"; }
short() { printf '%s' "${1:0:7}"; }
current_branch() { git rev-parse --abbrev-ref HEAD; }

require_clean_tree() {
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "commit or discard tracked changes first:\n$(git status --short)"
}

# Task metadata lives in an ignored JSON file inside each worktree.
task_write() {
  # usage: task_write key=value ...
  need node
  node - "${ORBIT_TASK_FILE}" "$@" <<'NODE'
const [file, ...pairs] = process.argv.slice(2);
const fs = require('node:fs');
const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const next = Object.fromEntries(pairs.map((pair) => {
  const index = pair.indexOf('=');
  return [pair.slice(0, index), pair.slice(index + 1)];
}));
fs.writeFileSync(file, JSON.stringify({...current, ...next, updated: new Date().toISOString()}, null, 2) + '\n');
NODE
}

task_read() {
  # usage: task_read key  (prints empty string when absent)
  task_read_at "$(pwd)" "$1"
}

task_read_at() {
  # usage: task_read_at <worktree-path> key  (prints empty string when absent)
  local file="$1/${ORBIT_TASK_FILE}"
  [[ -f "${file}" ]] || { printf ''; return; }
  node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]];process.stdout.write(v==null?"":String(v))' "${file}" "$2" 2>/dev/null || printf ''
}

# The OPEN pull request for one head branch, or empty. `gh pr view <branch>`
# falls back to a MERGED pull request when no open one exists, so a reused branch
# name would re-attach to somebody else's finished work.
open_pr_for() {
  need gh
  gh pr list -R "${ORBIT_GITHUB_REPO}" --head "$1" --state open --json number --jq '.[0].number // ""' 2>/dev/null || printf ''
}

# State of the most recent pull request for one head branch: OPEN | MERGED | CLOSED | empty.
pr_state_of() {
  command -v gh >/dev/null 2>&1 || { printf ''; return; }
  gh pr list -R "${ORBIT_GITHUB_REPO}" --head "$1" --state all --limit 1 --json state --jq '.[0].state // ""' 2>/dev/null || printf ''
}

# Same gate as CI: typecheck, verified build (which runs the full suite), and the
# Linux-only Python-less regression when the host can run it (CI always does).
run_checks() {
  log "running npm run typecheck"
  npm run typecheck
  log "running npm run build (bounded build + full test suite)"
  npm run build
  if [[ "$(uname -s)" == "Linux" ]]; then
    log "running the Python-less setup regression"
    node scripts/check-pythonless-tests.mjs
  else
    log "skipping the Linux-only Python-less regression on $(uname -s); Validate Orbit runs it"
  fi
}

# Status of the Validate Orbit workflow for one commit: success | failure | pending | none
ci_conclusion_for() {
  need gh
  gh run list -R "${ORBIT_GITHUB_REPO}" --workflow "${ORBIT_CI_WORKFLOW}" --commit "$1" --limit 5 \
    --json status,conclusion --jq 'if length==0 then "none" elif any(.[]; .conclusion=="success") then "success" elif any(.[]; .status!="completed") then "pending" else "failure" end' 2>/dev/null || printf 'none'
}
