#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

node scripts/port-sound.mjs
node scripts/package-aside.mjs

echo "Running bounded vinext build..."
node scripts/bounded-build.mjs "${vinext}"


# The release gate includes execution, PAFI, connector and UI contracts.
node --experimental-strip-types --test tests/*.test.mjs
