import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {beginTurn,finishTurn,findAction,listAgent,failTurn} from '../lib/orbit/agent/repository.ts';
import {runAgent,advanceAgent,parseAction} from '../lib/orbit/agent/runner.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {captureWorkspaceBasis,guardFor,guardMatches} from '../lib/orbit/agent/action-guard.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul');
const project={id:'p',name:'현재 프로젝트',color:'#5558e8',symbol:'O',goal:'결과물',due:addDays(today,7),priority:3};
const task={id:'t',title:'초안',projectId:'p',status:'todo',duration:30,due:addDays(today,1),impact:3,focus:false,definition:'초안 완성'};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function write(db,action){return writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:(await readWorkspace(db,'owner')).revision,action})}
async function seed(db){await write(db,{type:'project.upsert',project});await write(db,{type:'task.upsert',task,autoAssign:false})}
async function stage(db,actions){const id=randomUUID(),turn=await beginTurn(db,'owner',id,'검토'),revision=(await readWorkspace(db,'owner')).revision;const cards=actions.map(action=>({id:randomUUID(),turnId:id,title:'검토할 제안',reason:'검증',action,expectedRevision:revision,state:'pending',note:'',revisitDate:null,createdAt:new Date().toISOString()}));await finishTurn(db,'owner',id,turn.lease,{text:'승인 후 반영',sources:[]},cards);return cards}
async function connect(db){await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'token',connectionId:'c'},{connected:true},env.ORBIT_ENCRYPTION_KEY)}
function model(actions){globalThis.fetch=async(_url,options)=>Response.json(options.method==='POST'?{run_id:'run_1',status:'started'}:{object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify({kind:'final',text:'검토 완료',proposals:actions.map(action=>({title:'최신 제안',reason:'최신 기록',action}))})})}
async function complete(db,id){for(let i=0;i<4;i++)await advanceAgent(db,'owner',id,env)}

test('chat stages overlapping native events without model-supplied consent and asks the owner before an idempotent commit',()=>fixture(async db=>{
 await connect(db);const date=addDays(today,1),busy={id:'busy',title:'기존 회의',date,start:600,end:660,kind:'meeting'};
 await write(db,{type:'event.upsert',event:busy});
 const action={type:'event.upsert',event:{...busy,id:'new-meeting',title:'겹치는 통화',start:630,end:675}};
 assert.throws(()=>parseAction({...action,overlapConfirmation:'model consent'}),/사용자/);
 const id=randomUUID();await runAgent(db,'owner',{id,message:'겹쳐도 통화 일정 제안해 줘'},env);model([action]);await complete(db,id);
 const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');const card=state.actions[0];assert.ok(card);assert.equal(card.action.overlapConfirmation,undefined);
 let confirmation;await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),error=>{assert.equal(error.code,'CALENDAR_OVERLAP');confirmation=error.details.overlapConfirmation;return true});
 assert.equal((await readWorkspace(db,'owner')).data.events.length,1);
 await write(db,{type:'event.upsert',event:{...busy,title:'변경된 회의'}});
 await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve',overlapConfirmation:confirmation},env),error=>{assert.equal(error.code,'CALENDAR_OVERLAP');assert.notEqual(error.details.overlapConfirmation,confirmation);confirmation=error.details.overlapConfirmation;return true});
 await decide(db,'owner',{id:card.id,decision:'approve',overlapConfirmation:confirmation},env);
 assert.equal((await readWorkspace(db,'owner')).data.events.length,2);
 // Simulate a committed command whose card acknowledgement was lost.
 await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE id=?").bind(card.id).run();
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 assert.equal((await readWorkspace(db,'owner')).data.events.length,2);assert.equal((await findAction(db,'owner',card.id)).state,'approved');
}));

test('unrelated records no longer invalidate staged approvals and receipts remain exactly once',()=>fixture(async db=>{
 await seed(db);const [card]=await stage(db,[{type:'task.status',id:'t',status:'done'}]);
 await write(db,{type:'project.upsert',project:{...project,id:'unrelated',name:'다른 작업'}});
 await decide(db,'owner',{id:card.id,decision:'approve'},env);const once=await readWorkspace(db,'owner');
 assert.equal(once.data.tasks[0].status,'done');assert.equal(once.data.projects.length,2);
 await db.prepare("UPDATE orbit_agent_actions SET state='pending' WHERE id=?").bind(card.id).run();
 await write(db,{type:'task.focus',id:'t',focus:false});
 await decide(db,'owner',{id:card.id,decision:'approve'},env);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orbit_mutations WHERE operation_id=?').bind(card.id).first()).n,1);
}));
test('unrelated changes while the model runs publish reviewable cards without restarting analysis',()=>fixture(async db=>{
 await connect(db);const id=randomUUID();await runAgent(db,'owner',{id,message:'프로젝트 준비'},env);
 await write(db,{type:'project.upsert',project:{...project,id:'elsewhere',name:'다른 프로젝트'}});model([{type:'project.upsert',project}]);await complete(db,id);
 const state=await listAgent(db,'owner');assert.equal(state.turns[0].status,'completed');assert.equal(state.actions.length,1);
 await decide(db,'owner',{id:state.actions[0].id,decision:'approve'},env);assert.equal((await readWorkspace(db,'owner')).data.projects.length,2);
}));
test('changed target automatically gets a fresh pending card, and never applies on old approval',()=>fixture(async db=>{
 await connect(db);await seed(db);const [card]=await stage(db,[{type:'task.status',id:'t',status:'done'}]);
 await write(db,{type:'task.focus',id:'t',focus:true});const refreshed=await decide(db,'owner',{id:card.id,decision:'approve'},env);
 assert.ok(refreshed.refreshing);assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'todo');
 const duplicate=await decide(db,'owner',{id:card.id,decision:'approve'},env);assert.equal(duplicate.turnId,refreshed.turnId);
 model([{type:'task.status',id:'t',status:'done'}]);await complete(db,refreshed.turnId);
 assert.equal((await findAction(db,'owner',card.id)).state,'rejected');
 const replacement=(await listAgent(db,'owner')).actions.find(a=>a.turnId===refreshed.turnId);assert.equal(replacement.state,'pending');
 assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'todo');
 await decide(db,'owner',{id:replacement.id,decision:'approve'},env);assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'done');
}));
test('rejecting an old card during refresh suppresses replacement publication',()=>fixture(async db=>{
 await connect(db);await seed(db);const [card]=await stage(db,[{type:'task.status',id:'t',status:'done'}]);await write(db,{type:'task.focus',id:'t',focus:true});
 const refresh=await decide(db,'owner',{id:card.id,decision:'approve'},env);await decide(db,'owner',{id:card.id,decision:'reject'},env);
 model([{type:'task.status',id:'t',status:'done'}]);await complete(db,refresh.turnId);
 assert.equal((await listAgent(db,'owner')).actions.filter(a=>a.turnId===refresh.turnId).length,0);
 assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'todo');
}));
test('refresh without changes resolves old card instead of leaving a dead refresh pointer',()=>fixture(async db=>{
 await connect(db);await seed(db);const [card]=await stage(db,[{type:'task.status',id:'t',status:'done'}]);await write(db,{type:'task.focus',id:'t',focus:true});
 const refresh=await decide(db,'owner',{id:card.id,decision:'approve'},env);model([]);await complete(db,refresh.turnId);
 assert.equal((await findAction(db,'owner',card.id)).state,'rejected');assert.equal((await readWorkspace(db,'owner')).data.tasks[0].status,'todo');
}));
test('same-name project races and midnight invalidate only the affected intent',()=>fixture(async db=>{
 const data=(await readWorkspace(db,'owner')).data,newProject={...project,id:'new'};
 const action={type:'task.upsert',task:{...task,projectId:'new'},project:newProject,autoAssign:false};const guard=await guardFor(action,data);
 const changed=applyAction(data,{type:'project.upsert',project:{...newProject,id:'other'}});assert.equal(await guardMatches(guard,action,changed),false);
 await seed(db);const current=(await readWorkspace(db,'owner')).data,status={type:'task.status',id:'t',status:'done'};
 const before=await captureWorkspaceBasis(current,new Date('2026-09-20T14:59:59Z')),after=await captureWorkspaceBasis(current,new Date('2026-09-20T15:00:01Z'));
 assert.equal(await guardMatches(await guardFor(status,current,before),status,current,after),false);
}));
test('sequential task completion and check-in approve despite generated history receipt IDs',()=>fixture(async db=>{
 await seed(db);const cards=await stage(db,[{type:'task.status',id:'t',status:'done'},{type:'chief.checkin',energy:'low',strain:'heavy',note:'휴식 필요'}]);
 for(const card of cards)await decide(db,'owner',{id:card.id,decision:'approve'},env);
 const data=(await readWorkspace(db,'owner')).data;assert.equal(data.tasks[0].status,'done');assert.equal(data.chief.checkins[0].note,'휴식 필요');
}));
test('ordinary delivery replays failed receipts; explicit concurrent retries queue just one durable attempt',()=>fixture(async db=>{
 await connect(db);const input={id:randomUUID(),message:'검토'};const turn=await beginTurn(db,'owner',input.id,input.message);await failTurn(db,'owner',input.id,turn.lease,'실패');
 assert.equal(await runAgent(db,'owner',input,env,{defer:true}),'failed');assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs').first(),null);
 const results=await Promise.all([runAgent(db,'owner',{...input,retryFailed:true},env,{defer:true}),runAgent(db,'owner',{...input,retryFailed:true},env,{defer:true})]);assert.deepEqual(results,['running','running']);
 const rows=(await db.prepare('SELECT * FROM orbit_hermes_jobs').all()).results;assert.equal(rows.length,1);
 const current=await db.prepare('SELECT * FROM orbit_agent_turns WHERE id=?').bind(input.id).first();assert.equal(current.updated_at,rows[0].turn_lease);
 assert.notEqual(current.updated_at,turn.lease);
}));
