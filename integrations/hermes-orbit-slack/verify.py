"""Offline candidate verifier. Remote services in tests/demo are synthetic fixtures."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--full', action='store_true', help='Also run typecheck and Node tests; no build/deploy')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    root = folder.parents[1]
    env = dict(os.environ, PYTHONPATH=os.environ.get('HERMES_SOURCE', '/home/hermes/.hermes/hermes-agent'))
    python = os.environ.get('HERMES_PYTHON', '/home/hermes/.hermes/hermes-agent/venv/bin/python')
    prefix = ['uv', 'run', '--with', 'pytest', '--python', python, 'python']
    commands = {
        'pytest': prefix + ['-m', 'pytest', str(folder / 'tests'), '-q'],
        'demo': prefix + [str(folder / 'demo.py')],
    }
    if args.full:
        commands['typecheck'] = ['npx', '--no-install', 'tsc', '--noEmit', '--incremental', 'false']
        commands['node'] = ['node', '--experimental-strip-types', '--test'] + [str(p) for p in sorted((root / 'tests').glob('*.test.mjs'))]
    evidence = {'production_verified': False, 'independent_qa': 'pending', 'remote_fixture_boundary': True,
                'artifact_sha256': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                                    for p in sorted(folder.rglob('*.py')) if '__pycache__' not in p.parts}, 'runs': {}}
    for name, command in commands.items():
        run = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, timeout=600)
        evidence['runs'][name] = {'command': command, 'exit_code': run.returncode, 'output': run.stdout + run.stderr}
        print(f'{name}: exit {run.returncode}', flush=True)
        if run.returncode:
            print(run.stdout + run.stderr)
    if args.output:
        args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n')
    return int(any(run['exit_code'] for run in evidence['runs'].values()))


if __name__ == '__main__':
    sys.exit(main())
