import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {contract,schemaInventory,schemaChecks,hermesCheck,readiness} from '../lib/orbit/release/contract.ts';
import {releaseProbe} from '../lib/orbit/release/auth.ts';
import {runHealth,readEvidence,writeEvidence,currentReport} from '../lib/orbit/release/health.ts';
import {writeCommand} from '../db/repository.ts';
import {checkRelease} from '../scripts/release-contract-check.mjs';
const tree='a'.repeat(40),token='a'.repeat(64),now=Date.parse('2026-09-29T01:00:00Z');
const env={ORBIT_RELEASE_CONTRACT_TOKEN:token,ORBIT_RELEASE_CONTRACT_OWNER:'a',ORBIT_SITES_BEARER:'test-gate'};
const publication={tree,deploymentId:'appgdep_fixture',publishedAt:new Date(now-60000).toISOString()};
function bucket(){const objects=new Map();return {objects,async put(k,v){objects.set(k,new Uint8Array(v));return {size:v.byteLength}},async get(k){const value=objects.get(k);return value?{async arrayBuffer(){return value.buffer}}:null},async delete(k){objects.delete(k)}}}
async function fixture(fn){const db=createDatabase(),b=bucket();try{
 await db.prepare('CREATE TABLE d1_migrations (name TEXT)').run();
 for(const m of contract.migrations)await db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').bind(m.name).run();
 await writeCommand(db,'a',{operationId:crypto.randomUUID(),expectedRevision:0,action:{type:'event.upsert',event:{id:'fixture',title:'private-secret-title',date:'2026-09-29',start:600,end:660,kind:'meeting'}}});
 await writeEvidence(b,'a','hermes',{version:'2.2.1',hooks:contract.hermes.requiredHooks,checkedAt:new Date(now-1000).toISOString()});
 await fn(db,b);
}finally{db.close()}}
const fetcher=async(url,init)=>{assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer '+token);return Response.json({status:'ok',tree,probe:new URL(url).pathname})};

test('complete actual SQLite schema and migration ledger pass, without limit-50 inventory assumptions',()=>fixture(async(db)=>{
 const inventory=await schemaInventory(db);assert.ok(Object.keys(inventory.tables).length>50);assert.ok(inventory.tables.orbit_task_starts);assert.ok(inventory.tables.orbit_slack_requests);assert.equal(readiness(schemaChecks(inventory)),'verified');
}));
test('missing 0039/table fails with exact names and cannot be promoted',()=>fixture(async(db,b)=>{
 await db.prepare("DELETE FROM d1_migrations WHERE name='0039_slack_requests.sql'").run();await db.prepare('DROP TABLE orbit_slack_requests').run();
 const report=await runHealth(db,b,'a',env,tree,publication,'https://fixture.chatgpt.site',fetcher,now);
 assert.equal(report.status,'failed');assert.equal(report.features.slackRequests,false);assert.ok(report.checks.some(c=>c.reason.includes('orbit_slack_requests')&&c.status==='failed'));assert.ok(report.checks.some(c=>c.reason.includes('0039_slack_requests.sql')));
 assert.ok(!JSON.stringify(report).includes(token));assert.ok(!JSON.stringify(report).includes('private-secret-title'));
}));
test('missing column and absent migration ledger never count as ready',()=>fixture(async(db)=>{
 await db.prepare('ALTER TABLE orbit_task_starts RENAME COLUMN started_at TO legacy_start').run();await db.prepare('DROP TABLE d1_migrations').run();const checks=schemaChecks(await schemaInventory(db));assert.ok(checks.some(c=>c.reason.includes('orbit_task_starts.started_at')));assert.equal(checks.find(c=>c.id==='migrations').status,'blocked');
}));
test('old, incomplete, missing and stale Hermes evidence are not ready',()=>{
 for(const evidence of [null,{version:'2.1.0',hooks:contract.hermes.requiredHooks,checkedAt:new Date(now).toISOString()},{version:'2.2.1',hooks:[],checkedAt:new Date(now).toISOString()},{version:'99.0.0',hooks:contract.hermes.requiredHooks,checkedAt:new Date(now-86400001).toISOString()}])assert.notEqual(hermesCheck(evidence,now).status,'passed');
});
test('full successful probes create timestamped release evidence; new tree/stale receipt return pending',()=>fixture(async(db,b)=>{
 const report=await runHealth(db,b,'a',env,tree,publication,'https://fixture.chatgpt.site',fetcher,now);assert.equal(report.status,'verified');assert.deepEqual(report.features,{slackRequests:true,gotem:true});assert.equal(report.elapsedSeconds,60);assert.equal((await readEvidence(b,'a','latest')).tree,tree);assert.equal(currentReport(report,tree,now).status,'verified');assert.equal(currentReport(report,'b'.repeat(40),now).status,'pending');assert.equal(currentReport(report,tree,now+86400001).status,'pending');assert.equal(await readEvidence(b,'another-owner','latest'),null);
}));
test('wrong source, 401, timeout and missing service owner all stop promotion',()=>fixture(async(db,b)=>{
 for(const [configuration,read,expected] of [[env,async()=>Response.json({error:'Unauthorized'},{status:401}),'failed'],[env,async()=>{throw new Error('secret-transport-detail')},'pending'],[{...env,ORBIT_RELEASE_CONTRACT_OWNER:'other'},fetcher,'pending']]){
  const report=await runHealth(db,b,'a',configuration,tree,publication,'https://fixture.chatgpt.site',read,now);assert.equal(report.status,expected);assert.equal(report.features.slackRequests,false);assert.ok(!JSON.stringify(report).includes('secret-transport-detail'));
 }
 const mismatch=await runHealth(db,b,'a',env,tree,{...publication,tree:'b'.repeat(40)},'https://fixture.chatgpt.site',fetcher,now);assert.equal(mismatch.status,'failed');
}));
test('machine probes are explicitly scoped, no user identity or contents are returned',async()=>{
 let calls=0;const read=async owner=>{calls++;assert.equal(owner,'a');return {secret:'private-secret-title'}};
 const req=(query,auth=token,method='GET')=>new Request('https://fixture.chatgpt.site/api/slack-requests'+query,{method,headers:{Authorization:'Bearer '+auth}});
 assert.equal(await releaseProbe(req(''),env,tree,read),null);assert.equal(calls,0);
 assert.equal((await releaseProbe(req('?release_probe=1','b'.repeat(64)),env,tree,read)).status,401);
 assert.equal((await releaseProbe(req('?release_probe=1',token,'POST'),env,tree,read)).status,401);
 const ok=await releaseProbe(req('?release_probe=1'),env,tree,read);assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{status:'ok',tree,probe:'/api/slack-requests'});assert.equal(calls,1);
});
test('CLI preflight refuses a missing migration and does not request a deployment or mutation',()=>fixture(async(db)=>{
 const inventory=await schemaInventory(db);inventory.migrationNames.pop();let calls=0;const result=await checkRelease({phase:'preflight',tree,env,fetcher:async(u,i)=>{calls++;assert.equal(i.method,undefined);return Response.json({inventory})}});assert.equal(result.status,'blocked');assert.equal(calls,1);
}));
test('CLI cannot promote a partial fabricated green report',async()=>{
 const result=await checkRelease({phase:'verify',...publication,env,fetcher:async()=>Response.json({...publication,status:'verified',checks:[{id:'tree',status:'passed'}]})});assert.equal(result.status,'pending');
});
test('verification does not alter user data or roll back schema, even on failure',()=>fixture(async(db,b)=>{
 const before=await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind('a').first();
 await runHealth(db,b,'a',env,tree,publication,'https://fixture.chatgpt.site',async()=>Response.json({},{status:503}),now);
 assert.deepEqual(await db.prepare('SELECT state_json FROM orbit_workspaces WHERE owner_id=?').bind('a').first(),before);
 assert.equal(readiness(schemaChecks(await schemaInventory(db))),'verified');
}));
