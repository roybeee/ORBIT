import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const helper=new URL('../scripts/configure-hermes-orbit.py',import.meta.url).pathname;
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'orbit-hermes-'));try{
 const profile=join(root,'profile'),bin=join(root,'bin');mkdirSync(profile);mkdirSync(bin);
 const config='model: existing-hermes-model\nplatform_toolsets:\n  telegram: [messaging]\n',secret='EXISTING_PROVIDER_KEY=synthetic-provider-secret\nAPI_SERVER_KEY=synthetic-existing-gateway-secret\n';
 writeFileSync(join(profile,'config.yaml'),config);writeFileSync(join(profile,'.env'),secret,{mode:0o600});
 const run=()=>spawnSync('python3',[helper,'--profile-home',profile],{env:{...process.env,PATH:bin+':'+process.env.PATH},encoding:'utf8'});
 fn({root,profile,bin,config,secret,run});
}finally{rmSync(root,{recursive:true,force:true})}}
test('Hermes setup preserves provider credentials and gateway key without printing either secret',()=>fixture(({profile,bin,config,run})=>{
 writeFileSync(join(bin,'hermes'),'#!/bin/sh\nexit 0\n',{mode:0o700});const r=run();assert.equal(r.status,0,r.stderr);
 assert.equal(readFileSync(join(profile,'config.yaml'),'utf8'),config);const dotenv=readFileSync(join(profile,'.env'),'utf8');assert.ok(dotenv.includes('EXISTING_PROVIDER_KEY=synthetic-provider-secret'));assert.ok(dotenv.includes('API_SERVER_KEY=synthetic-existing-gateway-secret'));assert.ok(dotenv.includes('API_SERVER_HOST=127.0.0.1'));assert.equal(readFileSync(join(profile,'orbit-connection-key.txt'),'utf8'),'synthetic-existing-gateway-secret\n');assert.equal(statSync(join(profile,'orbit-connection-key.txt')).mode&0o777,0o600);assert.ok(!(r.stdout+r.stderr).includes('synthetic-'));
 assert.equal(run().status,0);assert.equal((readFileSync(join(profile,'.env'),'utf8').match(/^API_SERVER_KEY=/gm)??[]).length,1);
}));
test('a failed Hermes config command restores both original config and secrets',()=>fixture(({profile,bin,config,secret,run})=>{
 writeFileSync(join(bin,'hermes'),'#!/bin/sh\nprintf "broken" > "$HERMES_HOME/config.yaml"\nexit 1\n',{mode:0o700});const r=run();assert.notEqual(r.status,0);assert.equal(readFileSync(join(profile,'config.yaml'),'utf8'),config);assert.equal(readFileSync(join(profile,'.env'),'utf8'),secret);assert.equal(existsSync(join(profile,'orbit-connection-key.txt')),false);assert.ok(!(r.stdout+r.stderr).includes('synthetic-'));
}));
