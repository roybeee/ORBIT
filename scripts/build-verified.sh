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


# Validate the resumable connector protocol before any build can be published.
node --experimental-strip-types --test tests/meeting-memory.test.mjs tests/discord.test.mjs tests/data-manager.test.mjs tests/order-research.test.mjs tests/orders.test.mjs tests/agent.test.mjs tests/calendar-delete.test.mjs tests/calendar-outbox.test.mjs tests/calendar-live.test.mjs tests/sound.test.mjs tests/sound-drag.test.mjs tests/aside.test.mjs tests/aside-bridge.test.mjs tests/automation.test.mjs tests/phase1.test.mjs tests/phase2.test.mjs tests/phase3.test.mjs tests/phase4.test.mjs tests/phase5.test.mjs tests/workflow-activity.test.mjs tests/reliability.test.mjs
