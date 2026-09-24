import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote} from '../db/repository.ts';
import {digest} from '../lib/orbit/slack/directives.ts';

const moduleUrl='../lib/orbit/slack/commands.ts';
const token='test-only-integration-credential-1234567890';
const base={goal:'Progress',due:'2099-01-01',color:'#4455cc',symbol:'O',priority:3,status:'active'};
const projects=[
 {...base,id:'ofd',name:'Old Ferry Donut',keywords:['도넛']},
 {...base,id:'mapdal-seoul',name:'맵달SEOUL'},
 {...base,id:'mapdal-bunsik',name:'맵달BUNSIK'},
 {...base,id:'old',name:'끝난 프로젝트',status:'completed',result:'done'},
];
async function setup(){
 const service=await import(moduleUrl);const db=createDatabase();
 for(const [i,project] of projects.entries())await writeCommand(db,'owner',{operationId:'seed:'+i,expectedRevision:i,action:{type:'project.upsert',project}});
 await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await digest(token),'owner','TTEST','UTEST','directives:write',4102444800000).run();
 return {db,service};
}
const source={platform:'slack',workspaceId:'TTEST',requesterId:'UTEST',channelId:'CTEST',messageTs:'1790043198.626399',threadId:'1790043198.626399'};
const taskBody=(extra={})=>({operationKey:'slack:task:1',source,command:{kind:'task',title:'가맹 계약서 검토',due:'2026-10-02',project:'Old Ferry Donut',googleTask:{taskListId:'@default',taskId:'gt-1'},...extra}});
const noteBody=(extra={})=>({operationKey:'slack:note:1',source,command:{kind:'note',title:'맵달 회의 메모',text:'1) 원문\n2) 순서 보존',project:'맵달',...extra}});
function request(body,query='',credential=token){return new Request('https://orbit.test/api/integrations/slack/commands'+query,{method:body?'POST':'GET',headers:{authorization:'Bearer '+credential,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}
async function call(s,body,query,credential){const response=await s.service.handleCommand(s.db,request(body,query,credential));return {status:response.status,data:await response.json()}}

test('task with a clear project is created in ORBIT at once, linked to its Google Task, and replays idempotently',async()=>{const s=await setup();try{
 const first=await call(s,taskBody());
 assert.equal(first.status,200,JSON.stringify(first.data));
 assert.equal(first.data.status,'completed');assert.equal(first.data.kind,'task');
 assert.deepEqual(first.data.project,{id:'ofd',name:'Old Ferry Donut'});
 const task=(await readWorkspace(s.db,'owner')).data.tasks.find(t=>t.id===first.data.target.id);
 assert.equal(task.title,'가맹 계약서 검토');assert.equal(task.due,'2026-10-02');assert.equal(task.projectId,'ofd');assert.equal(task.status,'todo');
 assert.deepEqual(task.googleTask,{taskListId:'@default',taskId:'gt-1'});
 const again=await call(s,taskBody());
 assert.equal(again.data.id,first.data.id);
 assert.equal((await readWorkspace(s.db,'owner')).data.tasks.length,1);
 const read=await call(s,undefined,'?operationKey='+encodeURIComponent('slack:task:1'));
 assert.equal(read.status,200);assert.equal(read.data.target.id,first.data.target.id);
 assert.equal((await call(s,taskBody({title:'다른 내용'}))).status,409);
}finally{s.db.close()}});

test('an item without any project hint that no project matches goes to the Slack inbox without asking',async()=>{const s=await setup();try{
 const r=await call(s,taskBody({project:undefined,title:'오후 4시 전화하기',googleTask:undefined}));
 assert.equal(r.data.status,'completed');assert.equal(r.data.inbox,true);
 assert.deepEqual(r.data.project,{id:'slack-inbox',name:'Slack 보관함'});
 const data=(await readWorkspace(s.db,'owner')).data;
 assert.ok(data.projects.some(p=>p.id==='slack-inbox'));
 assert.equal(data.tasks.find(t=>t.id===r.data.target.id).projectId,'slack-inbox');
}finally{s.db.close()}});

test('a note whose text clearly names one project is saved there without a hint',async()=>{const s=await setup();try{
 const r=await call(s,noteBody({project:undefined,title:'도넛 신메뉴 아이디어',text:'도넛 시즌 메뉴 후보'}));
 assert.equal(r.data.status,'completed');assert.deepEqual(r.data.project,{id:'ofd',name:'Old Ferry Donut'});
 const note=await readNote(s.db,'owner',r.data.target.id);
 assert.equal(note.kind,'knowledge');assert.equal(note.projectId,'ofd');assert.equal(note.body,'도넛 시즌 메뉴 후보');
}finally{s.db.close()}});

test('an ambiguous project asks with numbered candidates, writes nothing, and a number reply saves it',async()=>{const s=await setup();try{
 const asked=await call(s,noteBody());
 assert.equal(asked.data.status,'needs_confirmation');assert.equal(asked.data.target,null);
 assert.deepEqual(asked.data.candidates,[{number:1,id:'mapdal-seoul',name:'맵달SEOUL'},{number:2,id:'mapdal-bunsik',name:'맵달BUNSIK'},{number:3,id:'slack-inbox',name:'Slack 보관함'}]);
 assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,0);
 assert.equal((await call(s,{operationKey:'slack:note:1',source,choice:9})).status,422);
 const chosen=await call(s,{operationKey:'slack:note:1',source,choice:2});
 assert.equal(chosen.status,200,JSON.stringify(chosen.data));
 assert.equal(chosen.data.status,'completed');assert.deepEqual(chosen.data.project,{id:'mapdal-bunsik',name:'맵달BUNSIK'});
 const note=await readNote(s.db,'owner',chosen.data.target.id);
 assert.equal(note.projectId,'mapdal-bunsik');assert.equal(note.body,'1) 원문\n2) 순서 보존');
 assert.equal((await call(s,{operationKey:'slack:note:1',source,choice:2})).data.target.id,chosen.data.target.id);
 assert.equal((await call(s,{operationKey:'slack:note:1',source,choice:1})).status,409);
 assert.equal((await readWorkspace(s.db,'owner')).data.notes.length,1);
}finally{s.db.close()}});

test('an exact project id or name wins over partial matches; completed projects are never chosen',async()=>{const s=await setup();try{
 assert.deepEqual((await call(s,{...noteBody({project:'맵달seoul'}),operationKey:'k1'})).data.project,{id:'mapdal-seoul',name:'맵달SEOUL'});
 assert.deepEqual((await call(s,noteBody({project:'mapdal-bunsik'}),undefined)).data.status,'completed');
 const done=await call(s,{...noteBody({project:'끝난 프로젝트'}),operationKey:'k3'});
 assert.equal(done.data.status,'needs_confirmation');
 assert.ok(!done.data.candidates.some(c=>c.id==='old'));
}finally{s.db.close()}});

test('credential, scope and input are enforced',async()=>{const s=await setup();try{
 assert.equal((await call(s,taskBody(),'','wrong-token-wrong-token-wrong-token-00')).status,401);
 assert.equal((await call(s,{...taskBody(),source:{...source,requesterId:'UOTHER'}})).status,403);
 assert.equal((await call(s,{...taskBody(),source:{...source,workspaceId:'TOTHER'}})).status,403);
 assert.equal((await call(s,taskBody({due:'2026-13-40'}))).status,422);
 assert.equal((await call(s,{...taskBody(),command:{kind:'event',title:'x'}})).status,422);
 assert.equal((await call(s,{operationKey:'missing',source,choice:1})).status,404);
 assert.equal((await readWorkspace(s.db,'owner')).data.tasks.length,0);
}finally{s.db.close()}});

test('a task created with a Google Task stores the shared starting point for two-way sync',async()=>{const s=await setup();try{
 const r=await call(s,taskBody());
 const link=await s.db.prepare('SELECT * FROM orbit_google_task_links WHERE owner_id=? AND task_id=?').bind('owner',r.data.target.id).first();
 assert.equal(link.google_task_id,'gt-1');
 assert.deepEqual(JSON.parse(link.state_json),{title:'가맹 계약서 검토',due:'2026-10-02',status:'needsAction',etag:''});
 const plain=await call(s,{...taskBody({googleTask:undefined}),operationKey:'no-google'});
 assert.equal(await s.db.prepare('SELECT 1 FROM orbit_google_task_links WHERE task_id=?').bind(plain.data.target.id).first(),null);
}finally{s.db.close()}});

test('a trashed Slack inbox gives a clear, non-retryable answer',async()=>{const s=await setup();try{
 await s.db.prepare("INSERT INTO orbit_data_trash(owner_id,id,category,record_id,title,payload_json,deleted_at) VALUES('owner','t1','projects','slack-inbox','Slack 보관함','{}','2026-09-25T00:00:00Z')").run();
 const r=await call(s,taskBody({project:undefined,title:'오후 4시 전화하기',googleTask:undefined}));
 assert.equal(r.status,409);assert.equal(r.data.error,'slack_inbox_in_trash');
}finally{s.db.close()}});

test('preflight confirms only the provisioned requester',async()=>{const s=await setup();try{
 assert.equal((await call(s,undefined,'?preflight=1&workspaceId=TTEST&requesterId=UTEST')).status,200);
 assert.equal((await call(s,undefined,'?preflight=1&workspaceId=TTEST&requesterId=UOTHER')).status,403);
}finally{s.db.close()}});
