"""Bounded metadata-only heartbeat; does not delay message handling or run an LLM."""
import threading
import time
VERSION = '2.2.1'
HOOKS = ('pre_gateway_dispatch', 'api_request_error', 'post_api_request', 'post_llm_call')
_lock = threading.Lock()
_last = 0.0


def report(send, hooks):
    registered = [h for h in HOOKS if h in hooks]
    status, _ = send('POST', {'version': VERSION, 'hooks': registered}, path='release-health')
    return status == 200


def heartbeat(send, hooks):
    global _last
    with _lock:
        now = time.monotonic()
        if _last and now - _last < 3600:
            return
        _last = now
    def run():
        try:
            report(send, hooks)
        except Exception:
            pass  # Readiness remains pending; do not expose credentials or break Slack.
    threading.Thread(target=run, daemon=True, name='orbit-release-health').start()
