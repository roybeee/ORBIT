#!/usr/bin/env bash
# Owner-run Sites publication for one verified GitHub revision, driven by the
# local Codex CLI and its bundled `sites-hosting` skill (the Sites connector is
# only available inside Codex/ChatGPT). Codex asks for approvals interactively;
# run this from a terminal, never unattended.
# usage: scripts/parallel/publish-sites.sh <github-sha> [--print] [--accept-shared-quota]
#   --print shows the Codex prompt and command without running Codex.
#   --accept-shared-quota silences the shared-account hint (Codex and Hermes share one
#   OpenAI account by owner decision; only an exhausted Hermes quota blocks).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

sha=""; print_only=0; quota_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --print) print_only=1; shift ;;
    --accept-shared-quota) quota_args+=(--accept-shared-quota); shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) sha="$1"; shift ;;
  esac
done
[[ -n "${sha}" ]] || die "usage: publish-sites.sh <github-sha> [--print] [--accept-shared-quota]"
need codex; need gh

main="$(fetch_verified_main)"
sha="$(git rev-parse "${sha}^{commit}")"
git merge-base --is-ancestor "${sha}" "${main}" || die "${sha} is not on ${ORBIT_REMOTE}/${ORBIT_MAIN_BRANCH}; publish only integrated revisions"
tree="$(tree_of "${sha}")"
ci="$(ci_conclusion_for "${sha}")"
[[ "${ci}" == "success" ]] || die "Validate Orbit for ${sha} is '${ci}', not success"

# Codex and Hermes may be signed into one OpenAI account; then this run spends the
# quota Hermes needs for planning (2026-09-23: Hermes 429, "retry after 393141s").
# Check before anything is cloned or started. --print only shows the verdict.
quota_status=0
node "$(dirname "${BASH_SOURCE[0]}")/preflight-quota.mjs" ${quota_args[@]+"${quota_args[@]}"} >&2 || quota_status=$?
if [[ ${quota_status} != 0 ]]; then
  if [[ ${print_only} == 1 ]]; then
    log "quota preflight would block this publication (exit ${quota_status}); showing the prompt anyway (--print)"
  else
    die "quota preflight blocked the publication (exit ${quota_status}); see the lines above"
  fi
fi

# Codex's workspace-write sandbox can only write inside the checkout, so the
# publish checkout must be a standalone clone (its own .git directory), not a
# worktree whose Git metadata lives in the main repository. Objects are
# hardlinked from the local repository, so the clone is fast and small.
checkout="$(dirname "$(main_worktree)")/${ORBIT_WORKTREE_PREFIX}publish-$(short "${sha}")"
if [[ -d "${checkout}" && ! -d "${checkout}/.git" ]]; then
  die "${checkout} exists but is not a standalone clone; remove it (git worktree remove --force ${checkout}) and rerun"
fi
if [[ ! -d "${checkout}" && ${print_only} == 0 ]]; then
  git clone --quiet --no-checkout "$(main_worktree)" "${checkout}"
  git -C "${checkout}" fetch --quiet origin "${sha}"
  git -C "${checkout}" checkout --quiet --detach "${sha}"
  git -C "${checkout}" remote remove origin
  log "created publish checkout ${checkout} (standalone clone at ${sha})"
fi
# Assert the state of the checkout every run, not only when it was just created:
# a leftover directory may sit at another revision or carry edits, and the build
# packages what is on disk while the projection commit records HEAD's tree.
if [[ ${print_only} == 0 ]]; then
  [[ "$(git -C "${checkout}" rev-parse HEAD)" == "${sha}" ]] || die "${checkout} is at $(git -C "${checkout}" rev-parse --short HEAD), not ${sha}; delete it and rerun"
  [[ -z "$(git -C "${checkout}" status --porcelain)" ]] || die "${checkout} has local modifications; delete it and rerun so the published bytes match ${sha}"
fi
project_id="$(git show "${sha}:.openai/hosting.json" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).project_id))')"

prompt="$(cat <<PROMPT
You are the Site-owning agent for the ORBIT Site (project_id ${project_id}, URL ${ORBIT_APP_URL:-https://orbit-personal-os.hflameb.chatgpt.site}). Publish the EXACT source checked out in this directory with the bundled sites-hosting skill (read its SKILL.md and references/environment.md first). Do not edit or format any file, do not commit or push to the GitHub origin remote, do not call open_in_codex.

Facts:
- This directory is a standalone detached clone of GitHub roybeee/ORBIT at ${sha} (tree ${tree}); its Validate Orbit CI succeeded.
- The Sites source repository keeps its own history. Publish an exact-tree projection: fetch the Sites main, create one commit whose tree is exactly ${tree} parented on the Sites main head (git commit-tree ${tree} -p FETCH_HEAD -m "Publish GitHub main ${sha}"), push it to the Sites main without force, and confirm git rev-parse <commit>^{tree} prints ${tree}. If the Sites main already has tree ${tree}, reuse it.
- Run npm ci, build with the plugin build-site.mjs (or npm run build, which also runs the tests), package with package-site.mjs, then save_version_and_deploy_private (or save_site_version + deploy_private_site_version) with the pushed Sites commit SHA and poll get_deployment_status to a terminal state.
- Obtain the Sites write credential through the connector, pass it only as a per-command HTTP header, never print or store it.

Finish with exactly this report:
GITHUB_SHA: ${sha}
TREE: <tree of the pushed Sites commit>
SITES_COMMIT: <sha>
SITES_VERSION: <id or number>
DEPLOYMENT_ID: <appgdep_...>
DEPLOYMENT_STATUS: <succeeded|failed|unknown>
NOTES: <build/test result and anything that failed>
PROMPT
)"

result="${checkout}/.sites-publish-result.md"
# The sandbox needs network access for the Sites git remote and connector uploads.
cmd=(codex exec -C "${checkout}" -s workspace-write -c 'sandbox_workspace_write.network_access=true' -o "${result}" -)
if [[ ${print_only} == 1 ]]; then
  printf '%s\n\n--- command ---\n' "${prompt}"; printf '%q ' "${cmd[@]}"; printf '\n'
  exit 0
fi

log "starting Codex Sites publication for ${sha} (tree ${tree}); approve its requests in this terminal"
printf '%s' "${prompt}" | "${cmd[@]}"
log "Codex finished; report:"
cat "${result}" >&2
# The sandbox is writable, so the prompt's "do not edit any file" is a request,
# not a guarantee. If the source changed, the deployed bytes are not ${sha} and
# the projection commit recorded a tree that was never built.
# A failing status must read as dirty, never as clean: the clone is deleted below.
dirty="$(git -C "${checkout}" status --porcelain -- . ':!.sites-publish-result.md' 2>&1)" || dirty="git status failed: ${dirty}"
[[ -z "${dirty}" ]] || cat >&2 <<WARN

[parallel] WARNING: the publish checkout was modified during publication:
${dirty}
The deployed bundle may not match ${sha}. Do not record this as a verified release
until the differences are reviewed and, if real, committed through a pull request.
WARN
# Archive the report where it outlives the clone: appended to the release record
# (when the main worktree has one) and copied to docs/releases/publish-reports/.
# Both land in the main worktree as uncommitted files; commit them in a docs PR.
main_root="$(main_worktree)"
sha7="$(short "${sha}")"
archived=0
if [[ -s "${result}" ]]; then
  mkdir -p "${main_root}/docs/releases/publish-reports"
  cp "${result}" "${main_root}/docs/releases/publish-reports/${sha7}.md" \
    && archived=1 && log "copied the report to ${main_root}/docs/releases/publish-reports/${sha7}.md"
  records=("${main_root}"/docs/releases/*-"${sha7}".md)
  if [[ -f "${records[0]}" ]]; then
    printf '\n## Publish report (%s UTC)\n\n```\n%s\n```\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat "${result}")" >>"${records[0]}"
    log "appended the report to ${records[0]}"
  else
    log "no docs/releases/*-${sha7}.md in ${main_root}; run release.sh first or add the report to the record by hand"
  fi
fi

# The clone holds node_modules (close to 1 GB). Remove it only when nothing but the
# report changed, the deployment succeeded, and the report was archived above.
if [[ -z "${dirty}" && ${archived} == 1 ]] && grep -Eq '^DEPLOYMENT_STATUS:[[:space:]]*succeeded' "${result}"; then
  rm -rf "${checkout}"
  log "removed the publish clone ${checkout} (clean, deployment succeeded, report archived)"
  kept=""
else
  kept="      the publish clone ${checkout} was kept (modified, not succeeded, or report missing); inspect it, then scripts/parallel/cleanup.sh --publish-clones"
fi
cat >&2 <<MSG

next: scripts/parallel/verify-deploy.sh ${sha}
      then fill DEPLOYMENT_ID / version into docs/releases/*-${sha7}.md and commit docs/releases/ in a docs PR
${kept}
MSG
