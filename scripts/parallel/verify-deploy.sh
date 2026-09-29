#!/usr/bin/env bash
# Confirm the running deployment was built from the given GitHub revision by
# checking the authenticated runtime schema, APIs and integration evidence.
# usage: scripts/parallel/verify-deploy.sh <github-sha> [--url https://host]
#   ORBIT_RELEASE_CONTRACT_TOKEN, ORBIT_SITES_BEARER, ORBIT_DEPLOYMENT_ID and ORBIT_PUBLISHED_AT are required.
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

# Full readiness supersedes tree-only health. The machine principal is read-only
# for business APIs; POST writes release evidence only, never workspace records.
contract_file="$(mktemp)"
git show "${sha}:lib/orbit/release/contract.json" > "${contract_file}"
export ORBIT_RELEASE_CONTRACT_FILE="${contract_file}"
export ORBIT_APP_URL="${url}"
export ORBIT_RELEASE_REPORT_PATH="${ORBIT_RELEASE_REPORT_PATH:-$(repo_root)/docs/releases/$(date -u +%F)-$(short "${sha}")-contract.json}"
node --experimental-strip-types "$(dirname "${BASH_SOURCE[0]}")/../release-contract-check.mjs" verify "${expected}" \
  || die "published but operational contract not verified; report retained. No DB rollback."
log "VERIFIED: operational release contract passed for ${sha}"
