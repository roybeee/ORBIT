"""Local real SDK -> gated HTTPS -> TypeScript/SQLite demo, never production.

Uses the continuous queued-message regression instead of the obsolete synthetic
HTTP/task fixture (which correctly fails the new HTTPS/origin transport fence).
Slack message readback and inference remain fixtures. All profiles are temporary;
non-loopback network is blocked by the test. Requires ORBIT_TEST_RUNTIME pointing
at the independently verified read-only runtime and pytest/Slack SDK installed.
"""
import os
from pathlib import Path
import subprocess
import sys


def main():
    runtime = os.environ.get('ORBIT_TEST_RUNTIME')
    if not runtime or not Path(runtime).is_dir():
        raise SystemExit('ORBIT_TEST_RUNTIME must identify the verified staging runtime')
    tests = Path(__file__).parent / 'tests' / 'test_gated_registry.py'
    # One fresh scoped executor case; the full suite covers the complete matrix.
    result = subprocess.run([
        sys.executable, '-m', 'pytest', '-q', '-s',
        str(tests) + '::test_continuous_queue_registry[True-None]',
    ], check=False)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
