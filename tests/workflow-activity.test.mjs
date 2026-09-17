import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {dispatchOrder,advanceOrder,listOrders} from '../lib/orbit/agent/orders.ts';
import {changeAsideJob,listAsideJobs} from '../lib/orbit/aside/jobs.ts';
import {syncActivity,listActivity,activityDetail,classifyActivity,activityStatus} from '../lib/orbit/agent/activity.ts';
import {readWorkspace} from '../db/repository.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')},token='test-connection-secret';
const caps={object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,run_steer:true,run_approval_response:true,approval_events:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}};
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token,connectionId:'connection-a'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db);}finally{globalThis.fetch=fetch;db.close();}}
const input={type:'agent.dispatch',title:'ODA 경쟁 메뉴 조사',instruction:'ASIDE 브라우저에서 ODA 경쟁 메뉴 자료를 읽고 근거와 요약을 보고해 줘.',mode:'workflow',projectId:null,taskIds:[]};
function native(outputs,hook){const submissions=[],keys=[];globalThis.fetch=async(url,init={})=>{
 if(url.endsWith('/v1/capabilities'))return Response.json(caps);
 if(url.endsWith('/v1/toolsets'))return Response.json({data:[]});
 if(init.method==='POST'){submissions.push(JSON.parse(init.body));keys.push(init.headers['Idempotency-Key']);return Response.json({run_id:'run_'+submissions.length}, {status:202})}
 if(hook)await hook(url);const n=Number(url.split('_').at(-1));return Response.json({object:'hermes.run',run_id:'run_'+n,status:'completed',output:JSON.stringify(outputs[n-1])});
 };return {submissions,keys};}
const aside={kind:'orbit.aside',title:'경쟁 메뉴 조사',instruction:'https://example.com 에서 공개된 메뉴와 가격을 조회해 근거와 함께 정리하세요.'};
async function report(db,id,status='needs_review'){const job=await changeAsideJob(db,'owner',{action:'claim',id,bridgeId:randomUUID(),account:'u0'});return changeAsideJob(db,'owner',{action:'report',id,...{bridgeId:job.bridgeId,runId:job.runId},seq:1,status,progress:'조회 종료',result:'메뉴 조회 결과 https://example.com/source'});}
test('one order survives Hermes → ASIDE → Hermes with durable result, distinct idempotency keys and no duplicate browser enqueue',()=>fixture(async db=>{
 const mock=native([aside,{kind:'orbit.report',report:'공개 메뉴 조회 완료. 근거 https://example.com/source'}]);
 const id=randomUUID(),start=await dispatchOrder(db,'owner',id,input,env);assert.equal(start.status,'waiting_for_aside');assert.equal((await listAsideJobs(db,'owner')).length,1);
 await advanceOrder(db,'owner',id,env,{action:'poll',id});assert.equal(mock.submissions.length,1);assert.equal((await listAsideJobs(db,'owner')).length,1);
 const web=await report(db,start.workflow.asideJobId);assert.equal(web.parentOrderId,id);
 const pending=await advanceOrder(db,'owner',id,env,{action:'poll',id});assert.equal(pending.status,'queued');
 const done=await advanceOrder(db,'owner',id,env,{action:'poll',id});assert.equal(done.status,'completed');assert.match(done.output,/공개 메뉴/);assert.equal(done.workflow.receipts.length,1);assert.equal(mock.submissions.length,2);assert.notEqual(mock.keys[0],mock.keys[1]);assert.match(mock.submissions[1].input,/메뉴 조회 결과/);assert.match(mock.submissions[1].input,/REFERENCE SNAPSHOT/);
 assert.equal((await listOrders(db,'owner')).length,1);assert.equal((await readWorkspace(db,'owner')).revision,0);assert.deepEqual(await listOrders(db,'stranger'),[]);
}));
test('ASIDE uncertainty never resumes Hermes until user confirms the result',()=>fixture(async db=>{
 const mock=native([aside,{kind:'orbit.report',report:'결과 검토'}]),id=randomUUID(),start=await dispatchOrder(db,'owner',id,input,env),job=await report(db,start.workflow.asideJobId,'needs_attention');
 assert.equal((await advanceOrder(db,'owner',id,env,{action:'poll',id})).status,'waiting_for_aside');assert.equal(mock.submissions.length,1);
 await changeAsideJob(db,'owner',{action:'confirm_result',id:job.id,bridgeId:job.bridgeId,runId:job.runId,seq:2,result:job.result});
 assert.equal((await advanceOrder(db,'owner',id,env,{action:'poll',id})).status,'queued');
}));
test('concurrent stop prevents next ASIDE enqueue and stopped queued parent cannot be claimed',()=>fixture(async db=>{
 const id=randomUUID();native([aside],async()=>{await db.prepare('UPDATE orbit_agent_orders SET stop_requested=1 WHERE owner_id=? AND id=?').bind('owner',id).run()});
 assert.equal((await dispatchOrder(db,'owner',id,input,env)).status,'cancelled');assert.equal((await listAsideJobs(db,'owner')).length,0);
 native([aside]);const next=await dispatchOrder(db,'owner',randomUUID(),input,env);await db.prepare('UPDATE orbit_agent_orders SET stop_requested=1 WHERE owner_id=? AND id=?').bind('owner',next.id).run();await assert.rejects(()=>report(db,next.workflow.asideJobId),e=>e.code==='ORDER_STATE');
}));
async function project(db){const state=await readWorkspace(db,'owner');state.data.projects=[{id:'oda',name:'ODA PIZZA',keywords:['ODA'],color:'#abc',symbol:'O',goal:'운영',due:'2026-12-31',priority:3}];await db.prepare('INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) VALUES(?,0,?,?,?)').bind('owner',JSON.stringify(state.data),randomUUID(),new Date().toISOString()).run();}
function sessions(list,messages,extra){globalThis.fetch=async url=>{
 const u=new URL(url);if(u.pathname==='/api/sessions')return Response.json({object:'list',data:list,has_more:false});
 const match=u.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);if(match){const id=decodeURIComponent(match[1]);if(extra)return extra(id,u);const all=messages[id]??[];const offset=Number(u.searchParams.get('offset'));return Response.json({object:'list',session_id:id,data:all.slice(offset,offset+50),pagination:{offset}})}
 return Response.json({object:'hermes.session',session:list.find(s=>s.id===decodeURIComponent(u.pathname.split('/').at(-1)))});
};}
test('cross-channel sync classifies, redacts, deduplicates, searches tool output and preserves manual corrections',()=>fixture(async db=>{
 await project(db);const list=[{id:'slack-a',source:'slack',title:'ODA 매출 분석',message_count:2,last_active:1},{id:'cli-a',source:'cli',title:'생각 정리',message_count:1,last_active:1}];const messages={'slack-a':[{id:1,role:'user',content:'ODA 매출 분석 '+token,timestamp:1},{id:2,role:'assistant',content:'확인 자료',timestamp:2,reasoning:'DO NOT IMPORT THIS',tool_calls:[{secret:'abc',tool:'read'}]}],'cli-a':[{id:3,role:'tool',content:'독특한 검색어 결과',tool_name:'terminal',timestamp:3}]};sessions(list,messages);
 await syncActivity(db,'owner',env);await syncActivity(db,'owner',env);const result=await listActivity(db,'owner');assert.equal(result.items.length,2);const slack=result.items.find(s=>s.source==='slack');assert.equal(slack.project_id,'oda');assert.equal(slack.category,'finance');const detail=await activityDetail(db,'owner',slack.id);assert.equal(detail.messages.length,2);assert.ok(!JSON.stringify(detail).includes(token));assert.ok(!JSON.stringify(detail).includes('DO NOT IMPORT'));assert.equal((await listActivity(db,'owner',{query:'독특한 검색어'})).items.length,1);
 await classifyActivity(db,'owner',slack.id,null,'general');list[0].last_active=2;await syncActivity(db,'owner',env);assert.equal((await activityDetail(db,'owner',slack.id)).record.project_id,null);assert.equal((await activityDetail(db,'owner',slack.id)).messages.length,2);assert.deepEqual((await listActivity(db,'stranger')).items,[]);await assert.rejects(()=>activityDetail(db,'stranger',slack.id),e=>e.code==='NOT_FOUND');
}));
test('growing long session uses monotonic pagination despite stale message_count',()=>fixture(async db=>{
 const list=[{id:'long',source:'slack',title:'긴 대화',message_count:60,last_active:1}],messages={long:Array.from({length:135},(_,i)=>({id:i+1,role:'user',content:'message '+i,timestamp:i}))};sessions(list,messages);
 for(let n=0;n<4;n++)await syncActivity(db,'owner',env);
 const count=await db.prepare('SELECT COUNT(*) AS n FROM orbit_activity_messages WHERE owner_id=?').bind('owner').first();assert.equal(count.n,135);
}));
test('compressed session canonicalizes record/cursor and deleted session does not block collection',()=>fixture(async db=>{
 const list=[{id:'deleted',source:'slack',message_count:1,last_active:1},{id:'old',source:'slack',message_count:200,last_active:2},{id:'tip',source:'slack',title:'압축된 대화',message_count:2,last_active:3}];sessions(list,{},(id,u)=>id==='deleted'?Response.json({}, {status:404}):Response.json({object:'list',session_id:'tip',data:[{id:201,role:'user',content:'new first',timestamp:1},{id:202,role:'assistant',content:'new last',timestamp:2}].slice(Number(u.searchParams.get('offset')))}));
 await syncActivity(db,'owner',env);await syncActivity(db,'owner',env);await syncActivity(db,'owner',env);const r=await listActivity(db,'owner');assert.equal(r.items.length,1);assert.equal(r.items[0].session_id,'tip');assert.equal((await activityDetail(db,'owner',r.items[0].id)).messages.length,2);assert.equal((await activityStatus(db,'owner')).lastError,'');
}));
