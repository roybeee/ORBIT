#!/usr/bin/env bash
# Owner-run: replace the live Hermes plugin with this directory, test it on the server, restart the hub gateway.
# usage: integrations/hermes-orbit-commands/deploy.sh [hermes@host]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-hermes@2.28.40.57}"
LIVE=.hermes/plugins/orbit-slack-directive-sync
TS=$(date +%Y%m%d-%H%M%S)

ssh "$HOST" "cp -a $LIVE ~/.hermes/plugins/orbit-slack-directive-sync.bak-$TS"
echo "backup: ~/.hermes/plugins/orbit-slack-directive-sync.bak-$TS"
scp -q "$HERE/__init__.py" "$HERE/plugin.yaml" "$HOST:$LIVE/"
ssh "$HOST" "rm -f $LIVE/tests/test_plugin.py && mkdir -p $LIVE/tests"
scp -q "$HERE/tests/test_plugin.py" "$HOST:$LIVE/tests/test_plugin.py"

if ! ssh "$HOST" "cd $LIVE && python3 -W error::ResourceWarning -m unittest discover -s tests"; then
  echo "server tests failed; restoring the backup"
  ssh "$HOST" "rm -rf $LIVE && cp -a ~/.hermes/plugins/orbit-slack-directive-sync.bak-$TS $LIVE"
  exit 1
fi
echo "local:  $(shasum -a 256 "$HERE/__init__.py" | cut -c1-16)"
echo "server: $(ssh "$HOST" "sha256sum $LIVE/__init__.py" | cut -c1-16)"
ssh "$HOST" "systemctl --user restart hermes-gateway.service && sleep 5 && systemctl --user is-active hermes-gateway.service"
echo "rollback: restore the backup directory to $LIVE and restart hermes-gateway.service"
