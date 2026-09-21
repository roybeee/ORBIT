import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {calibrationEvidence} from '../lib/orbit/planner.ts';
import {weeklyStats} from '../lib/orbit/derived.ts';
import {executionSamples} from '../lib/orbit/execution-history.ts';
import {workspaceDashboard} from '../lib/orbit/dashboard.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {dispatchOrder,advanceOrder,listOrders} from '../lib/orbit/agent/orders.ts';
import {advanceRuntimeWork} from '../lib/orbit/runtime-work.ts';
import {changeAsideJob} from '../lib/orbit/aside/jobs.ts';
import {syncActivity,activityStatus,listActivity} from '../lib/orbit/agent/activity.ts';
import {saveOrderReview,outputHash} from '../lib/orbit/agent/order-review.ts';
import {dispatchRework} from '../lib/orbit/agent/order-rework.ts';
const now=new Date('2026-09-21T03:00:00Z'),date='2026-09-21';
function seed(){const d=emptyWorkspace();d.projects=[{id:'p',name:'프로젝트',goal:'결과',due:date,color:'#7788ee',symbol:'P',priority:3}];d.tasks=[{id:'t',title:'할 일',projectId:'p',status:'todo',duration:30,due:date,impact:3,focus:false,definition:'결과 확인'}];return d;}
test('quick completion and recorded completion preserve the same measured outcome',()=>{
 const d=seed();d.tasks[0].status='doing';d.tasks[0].startedAt='2026-09-21T02:50:00Z';
 const quick=applyAction(d,{type:'task.status',id:'t',status:'done'},now);
 const full=applyAction(d,{type:'task.record',id:'t',outcome:'done'},now);
 for(const data of [quick,full]){const t=data.tasks[0];assert.equal(t.actualMinutes,10);assert.equal(t.outcome,'done');assert.equal(t.outcomeOn,date);assert.equal(t.outcomeEstimateMinutes,30);assert.equal(t.startedAt,undefined);assert.equal(data.executionHistory[0].actual,10);}
 const unmeasured=applyAction(seed(),{type:'task.status',id:'t',status:'done'},now);assert.equal(unmeasured.tasks[0].actualMinutes,undefined);assert.equal(unmeasured.executionHistory[0].actual,null);
});
test('waiting closes the timer and correction reopens a previously completed task',()=>{
 const d=seed();d.tasks[0].startedAt='2026-09-21T02:50:00Z';d.tasks[0].focus=true;d.tasks[0].focusDate=date;
 const waiting=applyAction(d,{type:'task.status',id:'t',status:'waiting'},now);assert.equal(waiting.tasks[0].startedAt,undefined);assert.equal(waiting.tasks[0].actualMinutes,10);assert.equal(waiting.tasks[0].focus,false);
 const done=applyAction(seed(),{type:'task.status',id:'t',status:'done'},now);
 const corrected=applyAction(done,{type:'task.record',id:'t',outcome:'partial',reason:'scope'},now);
 assert.equal(corrected.tasks[0].status,'doing');assert.equal(corrected.tasks[0].completedOn,undefined);assert.equal(executionSamples(corrected,date,date).rows[0].outcome,'partial');
});
test('editing yesterday records historical feedback without touching today or stopping its timer',()=>{
 const d=seed();Object.assign(d.tasks[0],{status:'doing',actualMinutes:80,startedAt:'2026-09-21T02:50:00Z'});
 const past='2026-09-20',action={type:'review.save',review:{date:past,win:'',block:'',energy:'normal'},detail:{date:past,items:[{taskId:'t',title:'어제 업무',estimateMinutes:30,actualMinutes:20,outcome:'partial',reason:'time'}],feedback:[],energy:{},smallWins:[],gratitude:[],habitChecks:[]}};
 const next=applyAction(d,action,now);assert.deepEqual(next.tasks[0],d.tasks[0]);assert.equal(next.executionHistory[0].actual,20);assert.equal(next.executionHistory[0].date,past);assert.equal(next.executionHistory[0].buffer,null);
});
test('frozen estimates and dated corrections feed planning and weekly statistics consistently',()=>{
 let d=seed();d.tasks=Array.from({length:5},(_,i)=>({...d.tasks[0],id:'t'+i}));
 for(const t of d.tasks)d=applyAction(d,{type:'task.record',id:t.id,outcome:'done',actualMinutes:60},now);
 for(const t of d.tasks){const {outcomeEstimateMinutes,...draft}=t;d=applyAction(d,{type:'task.upsert',task:{...draft,duration:120}},now);}
 assert.ok(d.tasks.every(t=>t.outcomeEstimateMinutes===30));
 const target={...d.tasks[0],id:'next'};assert.equal(calibrationEvidence(d.tasks,target,date,d.executionHistory).factor,2);assert.equal(weeklyStats(d,date).predictionAccuracy,2);
 const changed=structuredClone(d);changed.executionHistory.push({...changed.executionHistory[0],id:'correction',at:'2026-09-21T04:00:00Z',actual:15});
 assert.equal(executionSamples(changed,date,date).rows.find(r=>r.taskId==='t0').actual,15);
});
test('a user selected next action is consistent across project and home suggestions',()=>{
 const d=seed();d.tasks.push({...d.tasks[0],id:'b',title:'다음 행동',impact:1,due:'2026-09-23'});d.projects[0].nextTaskId='b';
 const dashboard=workspaceDashboard(d,now);assert.equal(dashboard.ready[0].id,'b');assert.equal(dashboard.chief.signals.find(s=>s.kind==='task').taskId,'b');
});

const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const caps={object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,run_steer:true,run_approval_response:true,approval_events:true,runs_idempotency:{durable:true,enabled:true,retention_seconds:86400}}};
const order={type:'agent.dispatch',title:'검증 업무',instruction:'자료를 조회하고 실제 결과와 근거를 보고하세요.',mode:'native',projectId:null,taskIds:[]};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test-secret',connectionId:'test-connection'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db);}finally{db.close();globalThis.fetch=fetch;}}
function mock(handler){globalThis.fetch=async(url,init={})=>url.endsWith('/v1/capabilities')?Response.json(caps):url.endsWith('/v1/toolsets')?Response.json({data:[]}):handler(url,init);}
test('approval continues through the server runtime with no foreground polling',()=>fixture(async db=>{
 let status='waiting_for_approval',polls=0;
 mock((url,init)=>{if(url.endsWith('/approval')){status='completed';return Response.json({object:'hermes.run.approval_response',run_id:'run_a',...JSON.parse(init.body),resolved:1})}if(init.method==='POST')return Response.json({run_id:'run_a'}, {status:202});polls++;return Response.json({object:'hermes.run',run_id:'run_a',status,output:'검증 결과',approval:{request_id:'approval-a',description:'작업 승인',choices:['once','deny']}})});
 const start=await dispatchOrder(db,'owner',randomUUID(),order,env);
 const approved=await advanceOrder(db,'owner',start.id,env,{action:'approval',id:start.id,requestId:'approval-a',choice:'once'});assert.equal(approved.status,'running');const before=polls;
 assert.equal((await advanceRuntimeWork(db,'owner',env)).active,true);assert.equal(polls,before+1);assert.equal((await listOrders(db,'owner'))[0].status,'completed');
}));
test('steering scope survives the ASIDE handoff and the next Hermes submission',()=>fixture(async db=>{
 const submitted=[];let stage='running';
 mock((url,init)=>{if(url.endsWith('/steer'))return Response.json({run_id:'run_1',accepted:true});if(init.method==='POST'){submitted.push(JSON.parse(init.body));return Response.json({run_id:'run_'+submitted.length},{status:202})}const run=url.split('/').at(-1);return Response.json({object:'hermes.run',run_id:run,status:stage==='running'?'running':'completed',output:JSON.stringify(run==='run_1'?{kind:'orbit.aside',title:'웹 조회',instruction:'https://example.com 공개 자료만 읽어 근거를 기록하세요.'}:{kind:'orbit.report',report:'범위 내 결과입니다.'})})});
 const start=await dispatchOrder(db,'owner',randomUUID(),{...order,mode:'workflow'},env);
 await advanceOrder(db,'owner',start.id,env,{action:'steer',id:start.id,input:'지난주 자료만 조회하세요. 외부 발송 금지.'});stage='aside';
 const pending=await advanceOrder(db,'owner',start.id,env,{action:'poll',id:start.id});
 const job=await changeAsideJob(db,'owner',{action:'claim',id:pending.workflow.asideJobId,bridgeId:randomUUID(),account:'a'});assert.match(job.instruction,/지난주 자료만/);
 await changeAsideJob(db,'owner',{action:'report',id:job.id,bridgeId:job.bridgeId,runId:job.runId,seq:1,status:'needs_review',progress:'끝',result:'지난주 자료 근거'});
 await advanceOrder(db,'owner',start.id,env,{action:'poll',id:start.id});await advanceOrder(db,'owner',start.id,env,{action:'poll',id:start.id});
 assert.equal(submitted.length,2);assert.match(submitted[1].input,/지난주 자료만 조회하세요. 외부 발송 금지/);
}));
test('a malformed activity session is isolated while the next valid session is collected',()=>fixture(async db=>{
 const hits=[];mock(url=>{if(new URL(url).pathname==='/api/sessions')return Response.json({object:'list',data:[{id:'bad',title:'오류',last_active:1,message_count:1},{id:'good',title:'정상',last_active:1,message_count:1}],has_more:false});const id=url.includes('/bad/')?'bad':'good';hits.push(id);return Response.json({object:'list',session_id:id,data:[{id:'m1',role:id==='good'?'assistant':null,content:'저장할 결과'}]})});
 await assert.rejects(()=>syncActivity(db,'owner',env),e=>e.code==='HERMES_FORMAT');
 for(let i=0;i<5;i++)await syncActivity(db,'owner',env);
 assert.equal(hits.filter(id=>id==='bad').length,1);assert.equal((await activityStatus(db,'owner')).quarantined,1);assert.equal((await listActivity(db,'owner')).items.length,1);
}));
test('rework preserves scope and evidence, rejects stale reviews, and creates only one child after retries',()=>fixture(async db=>{
 const submitted=[];mock((url,init)=>{if(init.method==='POST'){submitted.push(JSON.parse(init.body));return Response.json({run_id:'run_'+submitted.length},{status:202})}const id=url.split('/').at(-1);return Response.json({object:'hermes.run',run_id:id,status:'completed',output:'검토할 결과'})});
 const parent=await dispatchOrder(db,'owner',randomUUID(),order,env);
 const receipt=await saveOrderReview(db,'owner',{orderId:parent.id,verdict:'needs_work',criteria:'실제 근거 필요',evidence:'원문 링크가 빠짐',outputHash:await outputHash(parent.output)});
 const input={orderId:parent.id,outputHash:receipt.outputHash,reviewHash:receipt.reviewHash};
 const child=await dispatchRework(db,'owner',input,env);const repeated=await dispatchRework(db,'owner',input,env);
 assert.equal(child.id,repeated.id);assert.equal(child.parentOrderId,parent.id);assert.equal(submitted.length,2);assert.match(submitted[1].input,/원문 링크가 빠짐/);assert.match(submitted[1].input,/자료를 조회하고 실제 결과/);assert.match(submitted[1].input,/검토할 결과/);
 assert.equal((await listOrders(db,'owner')).find(o=>o.id===parent.id).review,'needs_work');
 await saveOrderReview(db,'owner',{orderId:parent.id,verdict:'accepted',criteria:'확인',evidence:'원문 확인 완료',outputHash:receipt.outputHash});
 await assert.rejects(()=>dispatchRework(db,'owner',input,env),e=>e.code==='CONFLICT');await assert.rejects(()=>dispatchRework(db,'other',input,env));
}));
