// Real subprocess integration with an empty Python cache and a PATH containing
// only Node and download/extraction tools, even on CI hosts that have Python.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, symlinkSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root=mkdtempSync(join(tmpdir(),'orbit-pythonless-'));
try {
  const bin=join(root,'bin');mkdirSync(bin);
  symlinkSync(process.execPath,join(bin,'node'));
  for(const name of ['curl','tar','gzip']){
    const target=execFileSync('sh',['-c',`command -v ${name}`],{encoding:'utf8'}).trim();
    symlinkSync(target,join(bin,name));
  }
  const env={...process.env,PATH:bin,ORBIT_TEST_PYTHON_CACHE:join(root,'cache')};
  assert.equal(spawnSync('python3',['--version'],{env}).error?.code,'ENOENT');
  console.log('Verified python3 ENOENT; running all five real setup tests with a cold pinned runtime.');
  const args=['--experimental-strip-types','--test','tests/hermes-setup.test.mjs'];
  const cwd=fileURLToPath(new URL('../',import.meta.url));
  for(const label of ['cold download','warm cache']){
    console.log(`Python-less regression: ${label}`);
    const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit',timeout:180_000});
    assert.ok(!result.error,`Test runner failed: ${result.error?.code}`);
    assert.equal(result.status,0,`${label}: real setup tests must all pass`);
  }
} finally { rmSync(root,{recursive:true,force:true}); }
