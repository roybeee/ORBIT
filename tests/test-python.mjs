// Test-only runtime: Sites' Node build image need not contain Python. Execute
// the real setup helper with CPython rather than dropping its integration tests.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {dirname, delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const release = '20260901';
const version = '3.12.14';
// GitHub release asset SHA-256 digests; never trust a checksum downloaded with
// the archive. Updates to these pins require review just like package-lock.json.
const builds = {
  x64: {triple: 'x86_64-unknown-linux-gnu', sha256: '72748da13197c1fb161e3afeef20a6a385ff24f2165e6e2758e47008e7faba4c'},
  arm64: {triple: 'aarch64-unknown-linux-gnu', sha256: '577b4bec0793ad1ff0cbff9adbd0df078eddde38a4c41bf5d83ad381a85ee39d'},
};
const defaultCache = fileURLToPath(new URL('../.sites-runtime/test-python/', import.meta.url));

function run(command, args, env, timeout = 30_000) {
  const result = spawnSync(command, args, {env, encoding: 'utf8', timeout});
  if (result.error || result.status !== 0) {
    // Do not echo subprocess output: setup tests deliberately exercise secrets.
    throw new Error(`Test Python prerequisite ${command} failed (${result.error?.code ?? result.signal ?? result.status}). Install Python 3.9+ or allow the pinned CPython download.`);
  }
  return result.stdout.trim();
}

export function verifyPythonArchive(archive, expected) {
  if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== expected) {
    throw new Error('Test Python archive SHA-256 mismatch; refusing to extract or execute it.');
  }
}

function environment(executable, env) {
  return {...env, PATH: dirname(executable) + delimiter + (env.PATH ?? '')};
}

const probe = ['-I', '-c', 'import sys; assert sys.version_info >= (3, 9); print(sys.executable)'];
export function testPython({env = process.env, cacheRoot = process.env.ORBIT_TEST_PYTHON_CACHE ?? defaultCache} = {}) {
  const system = spawnSync('python3', probe, {env, encoding: 'utf8', timeout: 30_000});
  if (!system.error && system.status === 0) {
    const executable = system.stdout.trim();
    return {executable, env: environment(executable, env)};
  }
  if (system.error?.code !== 'ENOENT') {
    throw new Error(`System python3 could not run (${system.error?.code ?? system.signal ?? system.status}); install a working Python 3.9+.`);
  }
  const build = process.platform === 'linux' && builds[process.arch];
  if (!build) throw new Error('No pinned test Python for this platform; install Python 3.9+ before running tests.');
  const destination = join(cacheRoot, `${version}-${release}-${build.triple}`);
  const executable = join(destination, 'python/bin/python3');
  if (!existsSync(executable)) {
    mkdirSync(cacheRoot, {recursive: true});
    const temporary = mkdtempSync(join(cacheRoot, '.install-'));
    try {
      const archive = join(temporary, 'python.tar.gz');
      const asset = `cpython-${version}%2B${release}-${build.triple}-install_only_stripped.tar.gz`;
      console.log(`[test-python] python3 absent; provisioning pinned CPython ${version} (${build.triple})`);
      run('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', '120', '--max-filesize', '80000000', '--output', archive, `https://github.com/astral-sh/python-build-standalone/releases/download/${release}/${asset}`], env, 130_000);
      verifyPythonArchive(archive, build.sha256);
      run('tar', ['-xzf', archive, '-C', temporary], env);
      rmSync(archive);
      run(join(temporary, 'python/bin/python3'), probe, env);
      try { renameSync(temporary, destination); }
      catch (error) {
        // Another test invocation may have atomically published the same pin.
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !existsSync(executable)) throw error;
      }
    } finally { rmSync(temporary, {recursive: true, force: true}); }
  }
  const resolved = run(executable, probe, env);
  return {executable: resolved, env: environment(resolved, env)};
}
