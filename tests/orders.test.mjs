import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {dispatchOrder,advanceOrder,listOrders,orderCapabilities} from '../lib/orbit/agent/orders.ts';
import {orderInput} from '../lib/orbit/agent/orders-schema.ts';
import {readWorkspace} from '../db/repository.ts';
import {beginTurn,finishTurn,findAction} from '../lib/orbit/agent/repository.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
import {parseAction} from '../lib/orbit/agent/protocol.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const order={type:'agent.dispatch',title:'구현 요청',instruction:'코드를 확인하고 개발팀에 독립 작업을 맡겨 테스트 결과를 보고해 줘.',projectId:null,taskIds:[]};
const caps={object:'hermes.api_server.capabilities',features:{run_submission:true,run_status:true,run_stop:true,run_steer:true,run_approval_response:true,approval_events:true,runs_idempotency:{supported:true,durable:true,retention_seconds:86400}}};
const j=(v,status=200)=>Response.json(v,{status});
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test-connection-secret',connectionId:'connection-a'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await fn(db);}finally{globalThis.fetch=fetch;db.close();}}
function native(handler){globalThis.fetch=async(url,init={})=>{if(url.endsWith('/v1/capabilities'))return j(caps);if(url.endsWith('/v1/toolsets'))return j({object:'list',data:[{enabled:true,configured:true,tools:['delegate_task','terminal']},{enabled:false,configured:true,tools:['forbidden']}]});return handler(url,init);};}
const remote=(id,status='running',extra={})=>j({object:'hermes.run',run_id:id,status,...extra});
test('native work orders run in independent sessions, are owner-scoped and archive real results without completing tasks',()=>fixture(async db=>{
 const bodies=[],keys=[];native((url,init)=>{if(init.method==='POST'){bodies.push(JSON.parse(init.body));keys.push(init.headers['Idempotency-Key']);return j({run_id:'run_'+bodies.length,status:'started'},202);}return remote(url.split('/').pop());});
 const a=await dispatchOrder(db,'owner',randomUUID(),order,env),b=await dispatchOrder(db,'owner',randomUUID(),{...order,title:'독립 조사'},env);
 assert.equal(a.status,'running');assert.notEqual(a.runId,b.runId);assert.notEqual(keys[0],keys[1]);assert.notEqual(bodies[0].session_id,bodies[1].session_id);assert.match(bodies[0].instructions,/native delegate_task/);assert.ok(!('toolsets' in bodies[0]));assert.ok(!('agent' in bodies[0]));
 assert.deepEqual(await listOrders(db,'stranger'),[]);await assert.rejects(()=>advanceOrder(db,'stranger',a.id,env,{action:'stop',id:a.id}),e=>e.code==='NOT_FOUND');
 native(url=>remote(url.split('/').pop(),'completed',{output:'검증한 결과: README 초안. test-connection-secret'}));
 const done=await advanceOrder(db,'owner',a.id,env,{action:'poll',id:a.id});assert.equal(done.status,'completed');assert.match(done.output,/초안/);assert.ok(!done.output.includes('test-connection-secret'));assert.equal((await readWorkspace(db,'owner')).revision,0);assert.equal((await listOrders(db,'owner')).find(o=>o.id===a.id).output,done.output);
}));
test('lost submit acknowledgement retries the identical durable key and body exactly, never another session',()=>fixture(async db=>{
 const id=randomUUID(),posts=[];let lost=true;native((url,init)=>{if(init.method==='POST'){posts.push({key:init.headers['Idempotency-Key'],session:init.headers['X-Hermes-Session-Key'],body:init.body});if(lost){lost=false;throw Error('lost acknowledgement')}return j({run_id:'run_a'},202);}return remote('run_a');});
 const first=await dispatchOrder(db,'owner',id,order,env);assert.equal(first.status,'submitting');assert.match(first.error,/도달/);const second=await dispatchOrder(db,'owner',id,order,env);assert.equal(second.runId,'run_a');assert.deepEqual(posts[0],posts[1]);assert.equal((await listOrders(db,'owner')).length,1);
}));
test('same-ID concurrent different instructions reject the losing payload',()=>fixture(async db=>{
 native((url,init)=>init.method==='POST'?j({run_id:'run_a'},202):remote('run_a'));const id=randomUUID();const result=await Promise.allSettled([dispatchOrder(db,'owner',id,order,env),dispatchOrder(db,'owner',id,{...order,title:'다른 지시',instruction:'다른 일'},env)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'CONFLICT');
}));
test('approval cards stage no execution; approval creates one real order even when repeated',()=>fixture(async db=>{
 let posts=0;native((url,init)=>init.method==='POST'?(posts++,j({run_id:'run_a'},202)):remote('run_a'));const turn=randomUUID(),id=randomUUID(),lease=await beginTurn(db,'owner',turn,'실제로 개발해 줘');
 await finishTurn(db,'owner',turn,lease.lease,{text:'승인하면 실행합니다.',sources:[]},[{id,turnId:turn,title:order.title,reason:'개발 실행',action:parseAction(order),expectedRevision:0,state:'pending',note:'',revisitDate:null,createdAt:new Date().toISOString()}]);assert.equal(posts,0);assert.deepEqual(await listOrders(db,'owner'),[]);
 await decide(db,'owner',{id,decision:'approve'},env);await decide(db,'owner',{id,decision:'approve'},env);assert.equal(posts,1);assert.equal((await findAction(db,'owner',id)).result.orderId,id);
}));
test('additional instructions are delivered only while running; a terminal race preserves failure',()=>fixture(async db=>{
 let status='running',steers=0;native((url,init)=>{if(url.endsWith('/steer')){steers++;return j({object:'hermes.run.steer',run_id:'run_a',accepted:true});}if(init.method==='POST')return j({run_id:'run_a'},202);return remote('run_a',status,{output:'실행 종료'});});const s=await dispatchOrder(db,'owner',randomUUID(),order,env);
 await advanceOrder(db,'owner',s.id,env,{action:'steer',id:s.id,input:'테스트 결과도 포함해 줘'});assert.equal(steers,1);status='completed';await assert.rejects(()=>advanceOrder(db,'owner',s.id,env,{action:'steer',id:s.id,input:'추가 요청'}),e=>e.code==='ORDER_STATE');assert.equal(steers,1);assert.equal((await listOrders(db,'owner'))[0].status,'completed');
}));
test('approval uses the exact fresh request, permits once/deny only and validates the response',()=>fixture(async db=>{
 let status='running',approvals=[];native((url,init)=>{if(url.endsWith('/approval')){const input=JSON.parse(init.body);approvals.push(input);return j({object:'hermes.run.approval_response',run_id:'run_a',...input,resolved:1});}if(init.method==='POST')return j({run_id:'run_a'},202);return remote('run_a',status,{approval:{request_id:'approval-current',description:'명령 실행',command:'git diff',choices:['once','deny']}});});const s=await dispatchOrder(db,'owner',randomUUID(),order,env);status='waiting_for_approval';
 await assert.rejects(()=>advanceOrder(db,'owner',s.id,env,{action:'approval',id:s.id,requestId:'stale',choice:'once'}),e=>e.code==='STALE_APPROVAL');assert.equal(approvals.length,0);
 await advanceOrder(db,'owner',s.id,env,{action:'approval',id:s.id,requestId:'approval-current',choice:'once'});assert.deepEqual(approvals,[{request_id:'approval-current',choice:'once'}]);assert.equal(orderInput.safeParse({action:'approval',id:s.id,requestId:'approval-current',choice:'always'}).success,false);
}));
test('stop requests remain stopping until Hermes confirms cancellation, including a lost submission',()=>fixture(async db=>{
 let status='running',stops=0;native((url,init)=>{if(url.endsWith('/stop')){stops++;return j({run_id:'run_a',status:'stopping'});}if(init.method==='POST')return j({run_id:'run_a'},202);return remote('run_a',status);});const s=await dispatchOrder(db,'owner',randomUUID(),order,env);assert.equal((await advanceOrder(db,'owner',s.id,env,{action:'stop',id:s.id})).status,'stopping');assert.equal(stops,1);status='cancelled';assert.equal((await advanceOrder(db,'owner',s.id,env,{action:'poll',id:s.id})).status,'cancelled');assert.equal(stops,1);
}));
test('expired ambiguous submissions, changed connections and missing run IDs never create replacement work',()=>fixture(async db=>{
 let posts=0;native((url,init)=>{if(init.method==='POST'){posts++;throw Error('lost acknowledgement')}return remote('run_a');});const s=await dispatchOrder(db,'owner',randomUUID(),order,env);const row=await db.prepare('SELECT state_json FROM orbit_agent_orders WHERE owner_id=? AND id=?').bind('owner',s.id).first();const data=JSON.parse(row.state_json);data.retryDeadline=Date.now()-1;await db.prepare('UPDATE orbit_agent_orders SET state_json=? WHERE owner_id=? AND id=?').bind(JSON.stringify(data),'owner',s.id).run();assert.equal((await advanceOrder(db,'owner',s.id,env,{action:'poll',id:s.id})).status,'unknown');assert.equal(posts,1);
 native((url,init)=>init.method==='POST'?(posts++,j({run_id:'run_b'},202)):remote('run_b'));const b=await dispatchOrder(db,'owner',randomUUID(),order,env);native(()=>j({},404));assert.equal((await advanceOrder(db,'owner',b.id,env,{action:'poll',id:b.id})).status,'unknown');assert.equal(posts,2);
 await saveConnection(db,'owner','hermes',{endpoint:'https://different.example.com',token:'new-secret',connectionId:'connection-b'},{connected:true},env.ORBIT_ENCRYPTION_KEY);let calls=0;native(()=>{calls++;return remote('run_b')});const changed=await advanceOrder(db,'owner',b.id,env,{action:'poll',id:b.id});assert.match(changed.error,/연결이 변경/);assert.equal(calls,0);
}));
test('only verified tools are exposed and memory-only idempotency is rejected before execution',()=>fixture(async db=>{
 native(()=>j({}));const result=await orderCapabilities(db,'owner',env);assert.equal(result.delegation,true);assert.deepEqual(result.tools,['delegate_task','terminal']);let posts=0;globalThis.fetch=async(url,init={})=>{if(init.method==='POST')posts++;return url.endsWith('/v1/capabilities')?j({...caps,features:{...caps.features,runs_idempotency:{supported:true,durable:false,retention_seconds:86400}}}):j({data:[]})};await assert.rejects(()=>dispatchOrder(db,'owner',randomUUID(),order,env),e=>e.code==='HERMES_VERSION');assert.equal(posts,0);
}));

// Regression: calendar IDs were submitted as task IDs and killed the entire chat.
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {listAgent,failTurn} from '../lib/orbit/agent/repository.ts';
import {orderReferences,orderLinkCatalog} from '../lib/orbit/agent/order-references.ts';
import {validateOrder} from '../lib/orbit/agent/orders.ts';
async function referenceFixture(db){
 const snapshot=await readWorkspace(db,'owner');
 const project=id=>({id,name:id==='personal'?'개인 생활':'개발 프로젝트',color:'#5558e8',symbol:'O',goal:'확인할 결과',due:'2026-12-31',priority:3});
 const task=(id,projectId)=>({id,projectId,title:id,status:'todo',duration:30,due:'2026-12-31',impact:3,focus:false,definition:'검토 가능한 결과'});
 snapshot.data.projects=[project('personal'),project('dev')];snapshot.data.tasks=[task('personal-task','personal'),task('dev-task','dev')];
 snapshot.data.events=[{id:'google:anniversary_2026',title:'결혼 기념일계획체크',date:'2026-09-27',start:540,end:570,kind:'meeting'}];
 await db.prepare('INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) VALUES(?,0,?,?,?)').bind('owner',JSON.stringify(snapshot.data),randomUUID(),new Date().toISOString()).run();return snapshot.data;
}
function chatReplies(outputs){let posts=0,executions=0;const bodies=[];native((url,init)=>{
 if(init.method==='POST'){const body=JSON.parse(init.body);bodies.push(body);if(body.instructions.includes('USER-AUTHORIZED WORK ORDER')){executions++;return j({run_id:'work_execution'},202);}posts++;return j({run_id:'chat_'+posts},202);}
 const run=url.split('/').pop();return run==='work_execution'?remote(run):remote(run,'completed',{output:JSON.stringify(outputs[Math.min(Number(run.split('_')[1])-1,outputs.length-1)])});
 });return {get posts(){return posts},get executions(){return executions},bodies};}
const calendarInstruction='결혼 기념일계획체크의 반복 시리즈 전체를 삭제하고 일반 할 일로 바꿔 줘. 다른 일정은 수정하지 마.';
const proposalFor=action=>({kind:'final',text:'지시할 내용을 제안했습니다. 승인하면 실행됩니다.',proposals:[{title:'반복 일정의 할 일 전환',reason:'중복 알림 정리',action}]});
async function finishChat(db,id){for(let i=0;i<9;i++){const turn=(await listAgent(db,'owner')).turns.find(t=>t.id===id);if(turn?.status!=='running')return turn;await advanceAgent(db,'owner',id,env);}throw Error('chat did not finish');}

test('calendar-to-task request repairs links once, preserves exact instruction and stays approval-gated',()=>fixture(async db=>{
 await referenceFixture(db);const bad={...order,title:'기념일 정리',instruction:calendarInstruction,projectId:'dev',taskIds:['google:anniversary_2026','future-new-task']};
 const mock=chatReplies([proposalFor(bad),{kind:'order_links',links:[{index:0,projectId:null,taskIds:[],eventIds:['google:anniversary_2026']}]}]);
 const id=randomUUID();await runAgent(db,'owner',{id,message:calendarInstruction},env);const turn=await finishChat(db,id);
 assert.equal(turn.status,'completed');assert.equal(mock.posts,2);assert.equal(mock.executions,0);assert.deepEqual(await listOrders(db,'owner'),[]);
 const card=(await listAgent(db,'owner')).actions[0];assert.equal(card.action.instruction,calendarInstruction);assert.equal(card.action.title,bad.title);assert.equal(card.title,'반복 일정의 할 일 전환');assert.deepEqual(card.action.taskIds,[]);assert.deepEqual(card.action.eventIds,['google:anniversary_2026']);assert.equal(card.action.projectId,null);
 assert.match(mock.bodies[1].input,/calendarIdsInTasks/);assert.match(mock.bodies[1].input,/결혼 기념일계획체크/);
 await decide(db,'owner',{id:card.id,decision:'approve'},env);assert.equal(mock.executions,1);const body=mock.bodies.find(b=>b.instructions.includes('USER-AUTHORIZED WORK ORDER'));assert.match(body.input,/google:anniversary_2026/);assert.match(body.input,/REFERENCE DATA/);assert.match(body.instructions,/does not inherit Orbit's private Google OAuth/);assert.equal((await readWorkspace(db,'owner')).data.events.length,1);
}));
test('unknown task, calendar-as-task and mismatched project references stay invalid at the execution boundary',()=>fixture(async db=>{
 const data=await referenceFixture(db);
 for(const refs of [{projectId:'dev',taskIds:['personal-task']},{projectId:null,taskIds:['google:anniversary_2026']},{projectId:null,taskIds:['future-new-task']},{projectId:null,taskIds:[],eventIds:['missing-event']}]){
  assert.throws(()=>orderReferences(data,{...order,...refs}),e=>e.code==='ORDER_REFERENCES');
  await assert.rejects(()=>validateOrder(db,'owner',{...order,...refs}),e=>e.code==='ORDER_REFERENCES');
 }
 assert.equal(orderReferences(data,{...order,projectId:null,taskIds:['personal-task','dev-task']}).tasks.length,2);assert.deepEqual((await readWorkspace(db,'owner')).data.tasks.map(t=>t.projectId),['personal','dev']);
 assert.equal(orderReferences(data,{...order,eventIds:['google:anniversary_2026']}).events.length,1);
 await assert.rejects(()=>validateOrder(db,'stranger',{...order,eventIds:['google:anniversary_2026']}),e=>e.code==='ORDER_REFERENCES');
}));
test('duplicate real references are deduplicated before staging, without another model run',()=>fixture(async db=>{
 await referenceFixture(db);const mock=chatReplies([proposalFor({...order,projectId:'personal',taskIds:['personal-task','personal-task'],eventIds:['google:anniversary_2026','google:anniversary_2026']})]);const id=randomUUID();await runAgent(db,'owner',{id,message:'자료를 확인해 줘'},env);await finishChat(db,id);const card=(await listAgent(db,'owner')).actions[0];assert.deepEqual(card.action.taskIds,['personal-task']);assert.deepEqual(card.action.eventIds,['google:anniversary_2026']);assert.equal(mock.posts,1);assert.equal(mock.executions,0);
}));
test('unresolved repairs and attempted instruction changes return readable non-executing replies',()=>fixture(async db=>{
 await referenceFixture(db);
 for(const reply of [
  {kind:'order_links',links:[{index:0,projectId:'dev',taskIds:['personal-task'],eventIds:[]}]},
  {kind:'order_links',links:[{index:0,projectId:null,taskIds:[],eventIds:[],instruction:'모든 일정을 삭제해'}]},
  {kind:'order_links',links:[]},
 ]){
  const mock=chatReplies([proposalFor({...order,instruction:calendarInstruction,taskIds:['unknown']}),reply]);const id=randomUUID();await runAgent(db,'owner',{id,message:calendarInstruction},env);const turn=await finishChat(db,id);assert.equal(turn.status,'completed');assert.match(turn.text,/실행을 시작하지 않았습니다/);assert.equal(mock.posts,2);assert.equal(mock.executions,0);assert.equal((await listAgent(db,'owner')).actions.filter(a=>a.turnId===id).length,0);
 }
 assert.equal((await readWorkspace(db,'owner')).data.events.length,1);
}));
test('an already failed message can be retried after reference repair is deployed',()=>fixture(async db=>{
 await referenceFixture(db);const id=randomUUID(),lease=await beginTurn(db,'owner',id,calendarInstruction);await failTurn(db,'owner',id,lease.lease,'업무 지시에 연결한 할 일과 프로젝트가 맞지 않습니다.');const mock=chatReplies([proposalFor({...order,instruction:calendarInstruction,eventIds:['google:anniversary_2026']})]);await runAgent(db,'owner',{id,message:calendarInstruction},env);assert.equal((await finishChat(db,id)).status,'completed');assert.equal(mock.posts,1);assert.equal(mock.executions,0);
}));
test('approved event references are rechecked if the saved event was removed after staging',()=>fixture(async db=>{
 await referenceFixture(db);chatReplies([proposalFor({...order,eventIds:['google:anniversary_2026']})]);const id=randomUUID();await runAgent(db,'owner',{id,message:'기념일 일정 정리'},env);await finishChat(db,id);const card=(await listAgent(db,'owner')).actions[0];const state=await readWorkspace(db,'owner');state.data.events=[];await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify(state.data),'owner').run();let executions=0;native((url,init)=>{if(init.method==='POST')executions++;return j({})});await assert.rejects(()=>decide(db,'owner',{id:card.id,decision:'approve'},env),e=>e.code==='ORDER_REFERENCES');assert.equal(executions,0);assert.equal((await findAction(db,'owner',card.id)).state,'pending');
}));
