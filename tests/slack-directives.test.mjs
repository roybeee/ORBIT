import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote} from '../db/repository.ts';
test('prepare lists canonical owner-scoped candidates without any receipt or note write',async()=>{const s=await setup();try{
 const before=await readWorkspace(s.db,'owner');
 const r=await call(s,'?prepareNote=1&workspaceId=TTEST&requesterId=UTEST');
 assert.equal(r.status,200);assert.equal(r.data.contract,'orbit-slack-note-prepare-v1');assert.deepEqual(r.data.candidates,[{id:'ofd',name:'Old Ferry Donut'}]);
 assert.deepEqual(await readWorkspace(s.db,'owner'),before);assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_slack_directives').first()).n,0);
 assert.equal((await call(s,'?prepareNote=1&workspaceId=TTEST&requesterId=OTHER')).status,403);
 assert.equal((await call(s,'?prepareNote=1&workspaceId=TTEST&requesterId=UTEST&projectId=other')).status,403);
}finally{s.db.close()}});
test('legacy status-omitted active projects remain candidates in prepare and receipt paths',async()=>{const s=await setup();try{
 const legacy={...project,id:'legacy',name:'Legacy active'};delete legacy.status;
 for(const p of [legacy,...['planned','paused','completed'].map(status=>({...project,id:status,name:status,status,...(status==='completed'?{result:'Finished fixture'}:{})}))]){
  await writeCommand(s.db,'owner',{operationId:'seed:'+p.id,expectedRevision:(await readWorkspace(s.db,'owner')).revision,action:{type:'project.upsert',project:p}});
 }
 const before=await readWorkspace(s.db,'owner');
 assert.equal(before.data.projects.find(p=>p.id==='legacy').status,undefined,'fixture must preserve legacy omitted status');
 const prepared=await call(s,'?prepareNote=1&workspaceId=TTEST&requesterId=UTEST');
 assert.equal(prepared.status,200);
 assert.deepEqual(prepared.data.candidates.map(p=>p.id).sort(),['legacy','ofd']);
 assert.deepEqual(await readWorkspace(s.db,'owner'),before,'prepare is read-only');
 const input={...wire(),operationKey:'legacy-candidates'};delete input.project;delete input.binding;
 const receipt=await call(s,'',input);
 assert.equal(receipt.status,200);assert.equal(receipt.data.status,'needs_confirmation');
 assert.deepEqual(receipt.data.candidates.slice().sort(),['legacy','ofd']);assert.equal(receipt.data.target,null);
 assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,0);
 assert.deepEqual((await call(s,'?id='+receipt.data.id)).data.candidates,receipt.data.candidates);
}finally{s.db.close()}});
const moduleUrl='../lib/orbit/slack/directives.ts';
const token='test-only-integration-credential-1234567890';
const project={id:'ofd',name:'Old Ferry Donut',goal:'Progress',due:'2099-01-01',color:'#4455cc',symbol:'O',priority:3,status:'active'};
async function setup(){const service=await import(moduleUrl);const db=createDatabase();await writeCommand(db,'owner',{operationId:'seed',expectedRevision:0,action:{type:'project.upsert',project}});await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await service.digest(token),'owner','TTEST','UTEST','directives:write',4102444800000).run();return {db,service}}
const wire=()=>({operationKey:'origin:test',source:{platform:'slack',workspaceId:'TTEST',requesterId:'UTEST',channelId:'CTEST',messageTs:'1790043198.626399',eventId:'EvTEST'},providerStatus:'succeeded',providerError:'',change:{kind:'note',title:'Knowledge progress',text:'  first\n2) second\n한글 원문  ',date:'2026-09-22'},project:{id:'ofd'},binding:{contract:'orbit-slack-v2',authorized:true,ownerId:'owner',workspaceId:'TTEST',requesterId:'UTEST',projectId:'ofd'}});
function request(path='',body,credential=token){return new Request('https://orbit.test/api/integrations/slack/directives'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}
async function call(s,path='',body,credential){const response=await s.service.handleDirective(s.db,request(path,body,credential));return {status:response.status,data:await response.json()}}
test('real canonical note and atomic receipt replay/readback',async()=>{assert.ok(await import(moduleUrl).catch(()=>null),'canonical Slack backend must exist');const s=await setup();try{const first=await call(s,'',wire());assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.status,'completed');const note=await readNote(s.db,'owner',first.data.target.id);assert.equal(note.kind,'knowledge');assert.equal(note.body,wire().change.text);assert.equal((await call(s,'',wire())).data.id,first.data.id);assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,1);assert.equal((await call(s,'?operationKey=origin%3Atest')).data.target.note.body,note.body);}finally{s.db.close()}});

test('authentication scope, posted owner, tenant project and receipt isolation',async()=>{const s=await setup();try{
 assert.equal((await call(s,'',wire(),'wrong')).status,401);
 for(const change of [{source:{...wire().source,requesterId:'UOTHER'}},{source:{...wire().source,workspaceId:'TOTHER'}},{binding:{...wire().binding,ownerId:'victim'}},{project:{id:'other'},binding:{...wire().binding,projectId:'other'}}])assert.equal((await call(s,'',{...wire(),...change})).status,403);
 const receipt=await call(s,'',wire());await s.db.prepare("UPDATE orbit_slack_credentials SET owner_id='other'").run();assert.equal((await call(s,'?id='+receipt.data.id)).status,404);assert.equal((await call(s,'?operationKey=origin%3Atest')).status,404);
 await s.db.prepare('UPDATE orbit_slack_credentials SET revoked=1').run();assert.equal((await call(s,'?id='+receipt.data.id)).status,401);
}finally{s.db.close()}});
test('unknown response reconciles; concurrent duplicate and conflicting writes create one note',async()=>{const s=await setup();try{
 const results=await Promise.all([call(s,'',wire()),call(s,'',wire()),call(s,'',{...wire(),change:{...wire().change,text:'conflicting'}})]);
 const winner=results.find(r=>r.status===200);assert.ok(winner,'one payload must win the atomic receipt race');
 const conflictWon=winner.data.change.text==='conflicting';
 assert.deepEqual(results.map(r=>r.status),conflictWon?[409,409,200]:[200,200,409]);
 for(const r of results){if(r.status===200)assert.equal(r.data.id,winner.data.id);else assert.equal(r.data.error,'payload_conflict')}
 const saved=(await call(s,'?operationKey=origin%3Atest')).data;
 assert.equal(saved.status,'completed');assert.equal(saved.id,winner.data.id);assert.equal(saved.target.note.body,conflictWon?'conflicting':wire().change.text);
 assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_slack_directives').first()).n,1);assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,1);
}finally{s.db.close()}});
test('absent or name-only destination returns bounded canonical candidates without target; failed provider persists failure',async()=>{const s=await setup();try{
 for(const [i,project] of [undefined,{name:'Old Ferry Donut'}].entries()){const input={...wire(),operationKey:'missing:'+i,project};delete input.binding;const r=await call(s,'',input);assert.equal(r.data.status,'needs_confirmation');assert.deepEqual(r.data.candidates,['ofd']);assert.equal(r.data.target,null)}
 const r=await call(s,'',{...wire(),providerStatus:'failed',providerError:'provider_failed'});assert.equal(r.data.status,'provider_failed');assert.equal(r.data.target,null);assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,0);
 assert.equal((await call(s,'',{...wire(),change:{kind:'task',text:'Task',due:'2026-09-22'}})).status,422);
 assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_calendar_exports').first()).n,0);
}finally{s.db.close()}});
test('receipt failure rolls back canonical note, chunks and mutation; commit lost ACK reconciles',async()=>{const s=await setup();try{
 const before=await readWorkspace(s.db,'owner');await s.db.prepare("CREATE TRIGGER fail_receipt BEFORE INSERT ON orbit_slack_directives BEGIN SELECT RAISE(ABORT,'test-only failure'); END").run();assert.equal((await call(s,'',wire())).status,503);assert.deepEqual(await readWorkspace(s.db,'owner'),before);assert.equal((await s.db.prepare('SELECT COUNT(*) n FROM orbit_note_revisions').first()).n,0);
 await s.db.prepare('DROP TRIGGER fail_receipt').run();const batch=s.db.batch.bind(s.db);let lost=false;s.db.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.includes('INSERT INTO orbit_slack_directives'))){lost=true;throw Error('lost commit acknowledgement')}return result};
 const result=await call(s,'',wire());assert.equal(result.data.status,'completed');assert.equal((await call(s,'?operationKey=origin%3Atest')).data.id,result.data.id);
}finally{s.db.close()}});
test('target readback detects edits/deletion instead of echoing receipt; revocation before batch blocks mutation',async()=>{const s=await setup();try{
 const first=await call(s,'',wire());const note=await readNote(s.db,'owner',first.data.target.id);await writeCommand(s.db,'owner',{operationId:'edit',expectedRevision:(await readWorkspace(s.db,'owner')).revision,action:{type:'note.upsert',note:{...note,body:'Changed'}}});assert.equal((await call(s,'?id='+first.data.id)).data.status,'target_changed');
 const batch=s.db.batch.bind(s.db);s.db.batch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO orbit_slack_directives')))await s.db.prepare('UPDATE orbit_slack_credentials SET revoked=1').run();return batch(statements)};
 const before=await readWorkspace(s.db,'owner');assert.notEqual((await call(s,'',{...wire(),operationKey:'revoked-at-commit'})).status,200);assert.deepEqual(await readWorkspace(s.db,'owner'),before);
}finally{s.db.close()}});
