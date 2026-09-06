#!/usr/bin/env python3
"""Apply the Orbit deep-thinking effort rule to a Hermes Agent gateway checkout.

Plain messages keep the profile's reasoning_effort (set it to medium); a message
that asks to think deeply (깊게, 깊이, 심층, 꼼꼼, deeply, thorough ...) runs that
one turn at high. Applies to Slack/Telegram/CLI turns; the API server (Orbit)
runs its own lifecycle and already sends an explicit effort per request.

Usage: python3 hermes-deep-effort-patch.py /path/to/hermes-agent   (idempotent)
"""
import py_compile
import shutil
import sys
import time
from pathlib import Path

ANCHOR = """        reasoning_config = self._runner._resolve_session_reasoning_config(
            source=ctx.source,
            session_key=ctx.session_key,
            model=model,
        )
        self._runner._reasoning_config = reasoning_config
"""
MARK = "# orbit-deep-effort"
INSERT = """        # orbit-deep-effort: a request to think deeply runs this turn at high effort.
        # Per-turn only; the API server (Orbit) sets its own effort per request.
        try:
            import re as _orbit_re
            _orbit_platform = getattr(getattr(ctx.source, "platform", None), "value", "")
            if _orbit_platform != "api_server" and _orbit_re.search(
                r"깊게|깊이|깊은|깊숙|심층|꼼꼼|신중|철저|곰곰|deep(?:ly|er)?\\b|thorough",
                ctx.message or "", _orbit_re.IGNORECASE,
            ):
                reasoning_config = {"enabled": True, "effort": "high"}
                self._runner._reasoning_config = reasoning_config
        except Exception as _orbit_err:
            logger.debug("orbit-deep-effort skipped: %s", _orbit_err)
"""


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: hermes-deep-effort-patch.py <hermes-agent checkout>")
    target = Path(sys.argv[1]).expanduser().resolve() / "gateway" / "run.py"
    if not target.is_file():
        sys.exit(f"gateway/run.py not found under {sys.argv[1]}")
    text = target.read_text(encoding="utf-8")
    if MARK in text:
        print("already patched:", target)
        return
    if text.count(ANCHOR) != 1:
        sys.exit("anchor not found exactly once; Hermes version differs, patch not applied")
    backup = target.with_name(f"run.py.bak-deep-effort-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(target, backup)
    target.write_text(text.replace(ANCHOR, ANCHOR + INSERT, 1), encoding="utf-8")
    try:
        py_compile.compile(str(target), doraise=True)
    except py_compile.PyCompileError as error:
        shutil.copy2(backup, target)
        sys.exit(f"compile failed, restored backup: {error}")
    print("patched:", target)
    print("backup:", backup)


if __name__ == "__main__":
    main()
