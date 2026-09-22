#!/usr/bin/env bash
# Confirm the running deployment was built from the given GitHub revision by
# comparing the tree hash reported by /api/deployment-health.
# usage: scripts/parallel/verify-deploy.sh <github-sha> [--url https://host]
#   ORBIT_RELEASE_HEALTH_TOKEN (64 hex) is read from the environment or a hidden prompt.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
need curl; need node

sha=""; url="${ORBIT_APP_URL:-https://orbit-personal-os.hflameb.chatgpt.site}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
    *) sha="$1"; shift ;;
  esac
done
[[ -n "${sha}" ]] || die "usage: verify-deploy.sh <github-sha> [--url https://host]"
git cat-file -e "${sha}^{commit}" 2>/dev/null || { git fetch --quiet "${ORBIT_REMOTE}" "${sha}" 2>/dev/null || die "commit ${sha} is not available locally or on ${ORBIT_REMOTE}"; }
expected="$(tree_of "${sha}")"

token="${ORBIT_RELEASE_HEALTH_TOKEN:-}"
if [[ -z "${token}" ]]; then
  IFS= read -rs -p "ORBIT_RELEASE_HEALTH_TOKEN (input hidden): " token </dev/tty; printf '\n' >&2
fi
[[ "${token}" =~ ^[0-9a-f]{64}$ ]] || die "the release health token must be 64 lowercase hex characters"

response="$(curl -sS --max-time 20 -H "Authorization: Bearer ${token}" -H 'Accept: application/json' "${url%/}/api/deployment-health")" \
  || die "deployment-health request failed"
unset token

read -r status build tree <<<"$(node -e '
  let value = {};
  try { value = JSON.parse(process.argv[1]); } catch {}
  console.log([value.status ?? "invalid", value.build ?? "-", value.tree ?? "-"].join(" "));
' "${response}")"

printf 'deployment  %s\n  status %s\n  build  %s\n  tree   %s\nexpected tree %s (GitHub %s)\n' "${url}" "${status}" "${build}" "${tree}" "${expected}" "${sha}"
[[ "${status}" == "ok" ]] || die "deployment-health did not answer ok (check the token and the deployed version)"
if [[ "${tree}" == "${expected}" ]]; then
  log "VERIFIED: the running app was built from GitHub ${sha}"
elif [[ "${tree}" == "unknown" ]]; then
  die "the deployment does not report a source tree yet (built before this change, or without git); compare Sites version manually"
else
  die "MISMATCH: running tree ${tree} is not GitHub ${sha}; production is on a different revision"
fi
