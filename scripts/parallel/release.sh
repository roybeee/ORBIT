#!/usr/bin/env bash
# Source release handoff: prove the exact GitHub main head passed CI, optionally
# push that exact revision to the Sites source repository, and record the mapping
# GitHub SHA -> tree so the Sites publication can be verified afterwards.
# usage: scripts/parallel/release.sh [--sites-remote <https-url>] [--record-pr] [--allow-unverified]
#   ORBIT_SITES_REMOTE_URL may replace --sites-remote. The Sites token is read from
#   a non-echoing prompt (or ORBIT_SITES_TOKEN_FD) and never placed in argv, files or logs.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need gh

sites_remote="${ORBIT_SITES_REMOTE_URL:-}"; record_pr=0; allow_unverified=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sites-remote) sites_remote="$2"; shift 2 ;;
    --record-pr) record_pr=1; shift ;;
    --allow-unverified) allow_unverified=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "unexpected argument $1" ;;
  esac
done

cd "$(repo_root)"
main="$(fetch_verified_main)"
tree="$(tree_of "${main}")"
today="$(date -u +%Y-%m-%d)"
record="docs/releases/${today}-$(short "${main}").md"

ci="$(ci_conclusion_for "${main}")"
if [[ "${ci}" != "success" ]]; then
  [[ ${allow_unverified} == 1 ]] || die "Validate Orbit for ${main} is '${ci}', not success; wait for CI or pass --allow-unverified with a written reason"
  log "WARNING: releasing ${main} with CI state '${ci}' (--allow-unverified)"
fi
run_url="$(gh run list -R "${ORBIT_GITHUB_REPO}" --workflow "${ORBIT_CI_WORKFLOW}" --commit "${main}" --limit 1 --json url --jq '.[0].url // ""' 2>/dev/null || true)"

sites_result="not pushed from this machine (hand off: scripts/parallel/publish-sites.sh ${main} pushes the exact tree ${tree} and publishes)"
if [[ -n "${sites_remote}" ]]; then
  [[ "${sites_remote}" == https://* ]] || die "--sites-remote must be an https URL"
  if [[ -n "${ORBIT_SITES_TOKEN_FD:-}" ]]; then
    IFS= read -r token <&"${ORBIT_SITES_TOKEN_FD}"
  else
    IFS= read -rs -p "Sites source token (input hidden): " token </dev/tty; printf '\n' >&2
  fi
  [[ -n "${token}" ]] || die "empty Sites token"
  # Header travels through git's environment config, never through argv.
  export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader
  export GIT_CONFIG_VALUE_0="Authorization: Bearer ${token}"
  unset token
  # The Sites source repository keeps its own history, so GitHub main is never a
  # fast-forward of it. Publish an exact-tree projection instead: one new commit
  # on top of the Sites main whose tree is exactly the verified GitHub tree.
  log "fetching Sites ${ORBIT_MAIN_BRANCH}"
  git fetch --quiet "${sites_remote}" "${ORBIT_MAIN_BRANCH}" 2>&1 | sed "s/${GIT_CONFIG_VALUE_0}/[REDACTED]/g" >&2 || true
  if git rev-parse --verify --quiet FETCH_HEAD >/dev/null; then
    sites_head="$(git rev-parse FETCH_HEAD)"
    if [[ "$(tree_of "${sites_head}")" == "${tree}" ]]; then
      projection="${sites_head}"
      log "Sites ${ORBIT_MAIN_BRANCH} ${sites_head} already has tree ${tree}; nothing to push"
    else
      projection="$(git commit-tree "${tree}" -p "${sites_head}" -m "Publish GitHub ${ORBIT_MAIN_BRANCH} ${main} (tree ${tree})")"
    fi
  else
    projection="$(git commit-tree "${tree}" -m "Publish GitHub ${ORBIT_MAIN_BRANCH} ${main} (tree ${tree})")"
  fi
  if [[ "${projection}" != "${sites_head:-}" ]]; then
    log "pushing projection ${projection} (tree ${tree}) -> Sites ${ORBIT_MAIN_BRANCH}"
    git push --quiet "${sites_remote}" "${projection}:refs/heads/${ORBIT_MAIN_BRANCH}" 2>&1 | sed "s/${GIT_CONFIG_VALUE_0}/[REDACTED]/g" >&2
  fi
  unset GIT_CONFIG_VALUE_0 GIT_CONFIG_KEY_0 GIT_CONFIG_COUNT
  sites_result="Sites source ${ORBIT_MAIN_BRANCH} = \`${projection}\` (exact tree ${tree}) at $(date -u +%H:%M:%SZ) UTC; publication (save version + deploy) still has to run: scripts/parallel/publish-sites.sh ${main}"
fi

mkdir -p docs/releases
cat > "${record}" <<RECORD
# Release ${today} · GitHub main $(short "${main}")

| Item | Value |
|---|---|
| GitHub \`main\` SHA | \`${main}\` |
| Source tree | \`${tree}\` |
| Validate Orbit | ${ci}${run_url:+ · ${run_url}} |
| Sites source push | ${sites_result} |
| Sites version / deployment | _pending_ (fill in after publication) |
| Verified running tree | _pending_ (\`scripts/parallel/verify-deploy.sh ${main}\`) |

A GitHub merge is a source release. Production is confirmed only when the
deployment-health endpoint reports tree \`${tree}\` and the authenticated app works.
RECORD
log "wrote ${record}"

if [[ ${record_pr} == 1 ]]; then
  branch="docs/release-$(short "${main}")"
  git worktree add --quiet -b "${branch}" "../${ORBIT_WORKTREE_PREFIX}release-$(short "${main}")" "${main}"
  cp "${record}" "../${ORBIT_WORKTREE_PREFIX}release-$(short "${main}")/${record}" 2>/dev/null || {
    mkdir -p "../${ORBIT_WORKTREE_PREFIX}release-$(short "${main}")/docs/releases"
    cp "${record}" "../${ORBIT_WORKTREE_PREFIX}release-$(short "${main}")/${record}"
  }
  (
    cd "../${ORBIT_WORKTREE_PREFIX}release-$(short "${main}")"
    git add "${record}"
    git commit --quiet -m "docs: record release $(short "${main}")"
    git push --quiet -u "${ORBIT_REMOTE}" "${branch}"
    gh pr create -R "${ORBIT_GITHUB_REPO}" --base "${ORBIT_MAIN_BRANCH}" --head "${branch}" --title "docs: record release $(short "${main}")" \
      --body "Release record for GitHub main \`${main}\` (tree \`${tree}\`). Docs only." >/dev/null
    gh pr merge -R "${ORBIT_GITHUB_REPO}" "${branch}" --auto --merge >/dev/null
  )
  log "release record PR opened from ${branch}; it merges through the queue"
fi

cat >&2 <<MSG

[parallel] release handoff
  GitHub main  ${main}
  tree         ${tree}
  CI           ${ci}
  Sites        ${sites_result}
  record       ${record}
next: scripts/parallel/publish-sites.sh ${main}  (owner runs; Codex Sites connector)\n      scripts/parallel/verify-deploy.sh ${main}   (after the deployment succeeds)
MSG
