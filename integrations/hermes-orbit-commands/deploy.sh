#!/usr/bin/env bash
# Owner-run: replace the live Hermes plugin with this directory, test it on the server, restart the hub
# gateway, and confirm the gateway's plugin loader registers the new tools.
# usage: integrations/hermes-orbit-commands/deploy.sh [hermes@host]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${1:-hermes@2.28.40.57}"
LIVE=.hermes/plugins/orbit-slack-directive-sync
# Backups must live outside ~/.hermes/plugins: Hermes loads every directory there, and a backup
# with the same plugin name silently replaces the live one.
BACKUPS=.hermes/plugin-backups
TS=$(date +%Y%m%d-%H%M%S)

ssh "$HOST" "mkdir -p $BACKUPS && for old in ~/.hermes/plugins/orbit-slack-directive-sync.bak-*; do [ -e \"\$old\" ] && mv \"\$old\" $BACKUPS/; done; cp -a $LIVE $BACKUPS/orbit-slack-directive-sync.bak-$TS"
echo "backup: ~/$BACKUPS/orbit-slack-directive-sync.bak-$TS"
scp -q "$HERE/__init__.py" "$HERE/receipts.py" "$HERE/plugin.yaml" "$HOST:$LIVE/"
ssh "$HOST" "rm -f $LIVE/tests/test_plugin.py $LIVE/tests/test_receipts.py && mkdir -p $LIVE/tests"
scp -q "$HERE/tests/test_plugin.py" "$HERE/tests/test_receipts.py" "$HOST:$LIVE/tests/"

restore() {
  ssh "$HOST" "rm -rf $LIVE && cp -a $BACKUPS/orbit-slack-directive-sync.bak-$TS $LIVE && systemctl --user restart hermes-gateway.service"
}
if ! ssh "$HOST" "cd $LIVE && python3 -W error::ResourceWarning -m unittest discover -s tests"; then
  echo "server tests failed; restoring the backup"; restore; exit 1
fi
for file in __init__.py receipts.py; do
  echo "$file local:  $(shasum -a 256 "$HERE/$file" | cut -c1-16)  server: $(ssh "$HOST" "sha256sum $LIVE/$file" | cut -c1-16)"
done
ssh "$HOST" "systemctl --user restart hermes-gateway.service && sleep 5 && systemctl --user is-active hermes-gateway.service"
# The same discovery the gateway runs; the new tools must be registered, not just copied.
tools=$(ssh "$HOST" 'cd ~/.hermes/hermes-agent && timeout 90 venv/bin/python -c "
from hermes_cli.plugins import get_plugin_manager
from tools.registry import registry
get_plugin_manager().discover_and_load()
print(\" \".join(sorted(registry.get_tool_names_for_toolset(\"orbit\"))))" 2>/dev/null')
# Requests are saved before the model runs only if the gateway hooks are registered too.
hooks=$(ssh "$HOST" 'cd ~/.hermes/hermes-agent && timeout 90 venv/bin/python -c "
from hermes_cli.plugins import get_plugin_manager
from hermes_cli.lifecycle import has_hook
get_plugin_manager().discover_and_load()
print(\" \".join(h for h in (\"pre_gateway_dispatch\",\"api_request_error\",\"post_llm_call\") if has_hook(h)))" 2>/dev/null')
echo "hooks: $hooks"
echo "orbit tools: $tools"
for required in orbit_slack_task orbit_slack_today; do
  if [[ " $tools " != *" $required "* ]]; then
    echo "the gateway does not register $required; restoring the backup"; restore; exit 1
  fi
done
for required in pre_gateway_dispatch api_request_error post_llm_call; do
  if [[ " $hooks " != *" $required "* ]]; then
    echo "the gateway does not register the $required hook; restoring the backup"; restore; exit 1
  fi
done
echo "rollback: copy ~/$BACKUPS/orbit-slack-directive-sync.bak-$TS to ~/$LIVE and restart hermes-gateway.service"
