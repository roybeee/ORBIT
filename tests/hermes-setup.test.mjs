import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {testPython} from './test-python.mjs';
const python=testPython();
const helper=new URL('../scripts/configure-hermes-orbit.py',import.meta.url).pathname;
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'orbit-hermes-'));try{
 const profile=join(root,'profile'),bin=join(root,'bin');mkdirSync(profile);mkdirSync(bin);
 const initial={model:'existing-hermes-model',platform_toolsets:{slack:['terminal','delegation'],api_server:['terminal','file','delegation','no_mcp']}};
 const config=JSON.stringify(initial),secret='EXISTING_PROVIDER_KEY=synthetic-provider-secret\nAPI_SERVER_KEY=synthetic-existing-gateway-secret\n';
 writeFileSync(join(profile,'config.yaml'),config);writeFileSync(join(profile,'.env'),secret,{mode:0o600});
 writeFileSync(join(bin,'hermes'),`#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['HERMES_HOME'])
a=sys.argv[1:]
c=json.loads((p/'config.yaml').read_text())
if a[1]=='get':
    if os.environ.get('READ_FAIL'): print('synthetic-read-secret',file=sys.stderr); sys.exit(1)
    if 'api_server' not in c['platform_toolsets']: sys.exit(1)
    print(json.dumps(c['platform_toolsets']['api_server'])); sys.exit(0)
with (p/'calls').open('a') as f: f.write(a[2]+'\\n')
if a[2]=='platform_toolsets.api_server': c['platform_toolsets']['api_server']=json.loads(a[3])
else: c['gateway']={'api_server':{'max_concurrent_runs':int(a[3])}}
(p/'config.yaml').write_text(json.dumps(c))
if os.environ.get('FAIL_KEY')==a[2]: print('synthetic-write-secret',file=sys.stderr); sys.exit(1)
`,{mode:0o700});
 const run=(args=[],extra={})=>{
  const result=spawnSync(python.executable,[helper,'--profile-home',profile,...args],{env:{...python.env,PATH:bin+':'+python.env.PATH,...extra},encoding:'utf8',timeout:30_000});
  assert.ok(!result.error,`Python setup process failed: ${result.error?.code}`);
  assert.equal(result.signal,null,'Python setup process must not be killed');
  return result;
 };
 const read=()=>JSON.parse(readFileSync(join(profile,'config.yaml'),'utf8'));
 fn({root,profile,bin,initial,config,secret,run,read});
}finally{rmSync(root,{recursive:true,force:true})}}
test('setup preserves existing execution tools, Slack tools, provider and gateway key',()=>fixture(({profile,initial,run,read})=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.deepEqual(read().platform_toolsets,initial.platform_toolsets);
 assert.equal(read().gateway.api_server.max_concurrent_runs,10);assert.equal(readFileSync(join(profile,'calls'),'utf8'),'gateway.api_server.max_concurrent_runs\n');
 const dotenv=readFileSync(join(profile,'.env'),'utf8');assert.ok(dotenv.includes('EXISTING_PROVIDER_KEY=synthetic-provider-secret'));assert.ok(dotenv.includes('API_SERVER_KEY=synthetic-existing-gateway-secret'));assert.ok(dotenv.includes('API_SERVER_HOST=127.0.0.1'));
 assert.equal(readFileSync(join(profile,'orbit-connection-key.txt'),'utf8'),'synthetic-existing-gateway-secret\n');assert.equal(statSync(join(profile,'orbit-connection-key.txt')).mode&0o777,0o600);assert.ok(!(r.stdout+r.stderr).includes('synthetic-'));
 assert.equal(run().status,0);assert.equal((readFileSync(join(profile,'.env'),'utf8').match(/^API_SERVER_KEY=/gm)??[]).length,1);
}));
test('only explicit proposal mode changes the API tools',()=>fixture(({initial,run,read})=>{
 const r=run(['--proposal-only']);assert.equal(r.status,0,r.stderr);assert.deepEqual(read().platform_toolsets.api_server,['no_mcp']);assert.deepEqual(read().platform_toolsets.slack,initial.platform_toolsets.slack);assert.match(r.stdout,/개발·위임 도구가 선택되어 있지 않습니다/);
}));
test('legacy string lists and explicitly empty selections are preserved',()=>fixture(({profile,initial,run,read})=>{
 for(const value of ["['terminal', 'delegation']",[],['no_mcp']]){
  writeFileSync(join(profile,'config.yaml'),JSON.stringify({...initial,platform_toolsets:{...initial.platform_toolsets,api_server:value}}));
  const r=run();assert.equal(r.status,0,r.stderr);assert.deepEqual(read().platform_toolsets.api_server,value);
  if(Array.isArray(value))assert.match(r.stdout,/개발·위임 도구가 선택되어 있지 않습니다/);
 }
}));
test('missing or malformed tools and failed discovery leave all settings untouched',()=>fixture(({profile,initial,secret,run})=>{
 for(const value of [undefined,{},[42],'not a list']){
  const config=JSON.stringify({...initial,platform_toolsets:{...initial.platform_toolsets,api_server:value}});writeFileSync(join(profile,'config.yaml'),config);
  const r=run();assert.notEqual(r.status,0);assert.equal(readFileSync(join(profile,'config.yaml'),'utf8'),config);assert.equal(readFileSync(join(profile,'.env'),'utf8'),secret);assert.equal(existsSync(join(profile,'orbit-connection-key.txt')),false);
 }
 const r=run([],{READ_FAIL:'1'});assert.notEqual(r.status,0);assert.ok(!(r.stdout+r.stderr).includes('synthetic-'));
}));
test('both first and second config-write failures roll back config and credentials',()=>fixture(({profile,config,secret,run})=>{
 for(const fail of ['gateway.api_server.max_concurrent_runs','platform_toolsets.api_server']){
  const r=run(['--proposal-only'],{FAIL_KEY:fail});assert.notEqual(r.status,0);assert.equal(readFileSync(join(profile,'config.yaml'),'utf8'),config);assert.equal(readFileSync(join(profile,'.env'),'utf8'),secret);assert.equal(existsSync(join(profile,'orbit-connection-key.txt')),false);assert.ok(!(r.stdout+r.stderr).includes('synthetic-'));
 }
}));
