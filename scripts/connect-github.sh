#!/usr/bin/env bash
# Run inside an authenticated GitHub CLI environment. Never embeds credentials.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
ORBIT_REPOSITORY='roybeee/ORBIT'
ORBIT_REMOTE_URL="https://github.com/${ORBIT_REPOSITORY}.git"
if ! command -v gh >/dev/null 2>&1; then
  printf '%s\n' 'GitHub CLI is required. Install it and sign in with gh auth login, then rerun this script.' >&2
  exit 1
fi
gh auth status --hostname github.com >/dev/null
ORBIT_LOGIN="$(gh api user --jq .login)"
if [[ "$ORBIT_LOGIN" != 'roybeee' ]]; then
  printf '%s\n' 'The signed-in GitHub account must be roybeee.' >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != 'main' || -n "$(git status --porcelain)" ]]; then
  printf '%s\n' 'Use the clean, committed main branch before connecting.' >&2
  exit 1
fi
if git remote get-url github >/dev/null 2>&1; then
  if [[ "$(git remote get-url github)" != "$ORBIT_REMOTE_URL" ]]; then
    printf '%s\n' 'The existing github remote points elsewhere. No remote was changed.' >&2
    exit 1
  fi
fi
# Use the exact repository selected by the user. Its public visibility is intentional here.
gh repo view "$ORBIT_REPOSITORY" --json nameWithOwner >/dev/null
if ! git remote get-url github >/dev/null 2>&1; then
  git remote add github "$ORBIT_REMOTE_URL"
fi
# Per-command helper only; do not modify global credential configuration.
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push github main:main
ORBIT_LOCAL_SHA="$(git rev-parse --verify HEAD)"
ORBIT_REMOTE_SHA="$(gh api "repos/${ORBIT_REPOSITORY}/git/ref/heads/main" --jq .object.sha)"
if [[ "$ORBIT_LOCAL_SHA" != "$ORBIT_REMOTE_SHA" ]]; then
  printf '%s\n' 'Remote verification failed. Inspect main before making further changes.' >&2
  exit 1
fi
printf '%s\n' "GitHub source verified: https://github.com/${ORBIT_REPOSITORY}"
