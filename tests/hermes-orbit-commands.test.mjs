import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {testPython} from './test-python.mjs';
// The Hermes Slack plugin is Python; run its unit tests with the pinned test CPython.
test('Hermes Slack→Google+ORBIT plugin unit tests pass',()=>{
 const python=testPython();
 const cwd=fileURLToPath(new URL('../integrations/hermes-orbit-commands/',import.meta.url));
 const result=spawnSync(python.executable,['-W','error::ResourceWarning','-m','unittest','discover','-s','tests'],{cwd,env:python.env,encoding:'utf8',timeout:60_000});
 assert.equal(result.status,0,result.stderr.slice(-4000));
});
