#!/usr/bin/env bash
# Starts ORBIT locally for the Playwright smoke: the Vite dev server with the
# Cloudflare plugin (workerd + local D1/R2 under .wrangler/state), after the
# committed drizzle migrations are applied to that same local D1 database.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
port="${ORBIT_E2E_PORT:-4317}"

export WRANGLER_WRITE_LOGS=false
export WRANGLER_LOG_PATH=.wrangler/logs

# Idempotent: wrangler records applied migrations in the local d1_migrations table.
npx wrangler d1 migrations apply DB --local \
  --config e2e/wrangler.e2e.jsonc --persist-to .wrangler/state

exec npx vite --port "${port}" --strictPort
