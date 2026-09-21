import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {testPython, verifyPythonArchive} from './test-python.mjs';

function fixture(fn) {
  const root=mkdtempSync(join(tmpdir(),'orbit-test-python-'));
  try { return fn(root); } finally { rmSync(root,{recursive:true,force:true}); }
}
test('test Python verifies pinned archive bytes and rejects tampered downloads before extraction',()=>fixture(root=>{
  const archive=join(root,'archive');
  writeFileSync(archive,'verified fixture bytes');
  const digest=createHash('sha256').update('verified fixture bytes').digest('hex');
  assert.doesNotThrow(()=>verifyPythonArchive(archive,digest));
  writeFileSync(archive,'changed fixture bytes');
  assert.throws(()=>verifyPythonArchive(archive,digest),/SHA-256 mismatch/);
}));
test('missing Python and download prerequisites fail closed and clean incomplete installs',()=>fixture(root=>{
  const bin=join(root,'bin'),cacheRoot=join(root,'cache');mkdirSync(bin);
  assert.throws(()=>testPython({env:{...process.env,PATH:bin},cacheRoot}),/curl failed \(ENOENT\)|No pinned test Python/);
  if(process.platform==='linux'&&['x64','arm64'].includes(process.arch))assert.deepEqual(readdirSync(cacheRoot),[]);
}));
test('an installed but broken Python is reported without leaking subprocess output',()=>fixture(root=>{
  const bin=join(root,'bin');mkdirSync(bin);
  writeFileSync(join(bin,'python3'),`#!${process.execPath}\nconsole.error('synthetic-private-output');process.exit(7);\n`,{mode:0o700});
  assert.throws(()=>testPython({env:{...process.env,PATH:bin},cacheRoot:join(root,'unused')}),error=>{
    assert.match(error.message,/System python3 could not run \(7\)/);
    assert.ok(!error.message.includes('synthetic-private-output'));
    return true;
  });
}));
