import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {planFromBrief} from '../lib/orbit/brief/planning.ts';
import {collectPlanningContext,completeBrief} from '../lib/orbit/brief/context.ts';
import {publishBrief} from '../lib/orbit/brief/publish.ts';
import {briefMessage} from '../lib/orbit/brief/schema.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {startPlanningAction} from '../lib/orbit/brief/start.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul'),date=addDays(today,1),planning={date,energy:'normal'};
const project={id:'p',name:'출시',goal:'검증 가능한 출시 결정',due:addDays(date,5),priority:5,color:'#5558e8',symbol:'P'};
const task={id:'t',title:'의사결정안',projectId:'p',status:'todo',due:date,impact:3,focus:false,duration:45,definition:'결정안 한 장'};
const content=()=>({headline:'내일은 출시 결정을 가능하게 만드는 조건부터 확정',assessment:'회의에서 남은 조건과 완료된 자료를 연결해 실행 순서를 제안합니다.',progress:[{text:'자료 준비가 완료되어 다음 결정을 진행할 수 있습니다.',evidence:['task:done']}],priorities:[{projectId:'p',taskId:'t',title:'의사결정안',outcome:'판단 가능한 결정안 한 장',whyNow:'출시 목표의 다음 관문이며 회의에서 확인된 미결을 해소합니다.',approach:['완료한 자료의 쟁점 비교','조건별 결론과 대안 작성'],minutes:45,evidence:['note:n','project:p']}],tradeoffs:[],risks:[],success:'결정권자가 선택할 수 있는 조건과 대안을 정리한다.',questions:[]});
const j=(data,status=200)=>Response.json(data,{status});
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function seed(db){let n=0;const send=async(action)=>{const out=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:n,action});n=out.revision};await send({type:'project.upsert',project});await send({type:'preferences.update',preferences:{...emptyWorkspace().preferences,workDays:[0,1,2,3,4,5,6]}});await send({type:'task.upsert',task});await send({type:'task.upsert',task:{...task,id:'done',title:'출시 자료',status:'done',result:'비교자료 확정',completedOn:today}});await send({type:'note.upsert',note:{id:'n',title:'출시 회의',kind:'meeting',projectId:'p',summary:'출시 검토',body:'최종 결정: 가격 조건이 확인될 때까지 출시 확정은 보류한다. 미결: 가격 조건.',tags:[],updated:today}});await send({type:'review.save',review:{date:today,win:'비교자료 확정',block:'가격 조건 미확인',energy:'normal'}});return readWorkspace(db,'owner')}
async function hermes(db){await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test-hermes-token',connectionId:'native'},{connected:true,endpoint:'https://hermes.example.com',model:'Hermes'},env.ORBIT_ENCRYPTION_KEY)}
const response=output=>j({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify(output)});
async function complete(db,id){await advanceAgent(db,'owner',id,env);await advanceAgent(db,'owner',id,env)}

test('planning context reads immutable meeting bodies, all tasks beyond the old 100 cap, and completed outcomes/reviews',()=>fixture(async db=>{
 let snapshot=await seed(db);const data=snapshot.data;data.tasks.push(...Array.from({length:110},(_,i)=>({...task,id:'task-'+i})));await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify(data),'owner').run();snapshot=await readWorkspace(db,'owner');
 assert.equal(snapshot.data.notes[0].body,'');const context=await collectPlanningContext(db,'owner',snapshot,planning,[],env);
 assert.equal(context.catalog.tasks.length,112);assert.match(context.catalog.notes[0].body,/가격 조건/);assert.equal(context.catalog.notes[0].bodyComplete,true);assert.equal(context.catalog.tasks.find(t=>t.id==='done').result,'비교자료 확정');assert.equal(context.catalog.reviews[0].block,'가격 조건 미확인');assert.equal(context.coverage.noteBodies,1);
 const other=await collectPlanningContext(db,'other',await readWorkspace(db,'other'),planning,[],env);assert.equal(other.coverage.tasks,0);assert.equal(other.coverage.notes,0);
}));

test('Hermes creates a persistent evidence-based brief with no task/calendar writes until priority approval',()=>fixture(async db=>{
 await seed(db);await hermes(db);let posts=0;
 globalThis.fetch=async(url,options={})=>{if(options.method==='POST'){posts++;const body=JSON.parse(options.body);assert.match(body.instructions,/one-page executive plan/);assert.match(body.input,/가격 조건/);assert.match(body.input,/비교자료 확정/);return j({run_id:'run_1',status:'started'},202)}return response({kind:'brief',brief:content()})};
 const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);await complete(db,id);let state=await readWorkspace(db,'owner');assert.equal(state.data.proposals[0].brief.headline,content().headline);assert.equal(state.data.events.length,0);assert.equal(state.data.tasks.length,2);assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first()).status,'completed');
 await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);assert.equal(posts,1);
 const item=state.data.proposals[0].items[0];state=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'proposal.approve',date,itemId:item.id}});assert.equal(state.data.events.length,1);
}));

test('strategic ranking controls allocation; new follow-ups stay drafts, defer without creating work, and materialize only on approval',()=>fixture(async db=>{
 const snapshot=await seed(db),ctx=await collectPlanningContext(db,'owner',snapshot,planning,[],env),c=content();c.priorities=[{...c.priorities[0],taskId:undefined,title:'가격 조건 확인',minutes:20},c.priorities[0]];
 const brief=completeBrief(c,ctx,planning,snapshot.revision,randomUUID());let data=applyAction(snapshot.data,{type:'proposal.brief',brief,energy:'normal'});const plan=data.proposals[0];assert.equal(data.tasks.length,2);assert.equal(plan.items[0].draftTask.title,'가격 조건 확인');assert.equal(plan.items[0].end-plan.items[0].start,20);
 data=applyAction(data,{type:'proposal.defer',date,itemId:plan.items[0].id,reason:'회신 후 진행',revisitDate:addDays(date,1)});assert.equal(data.tasks.length,2);assert.equal(data.proposals[0].items[0].state,'deferred');
 data=applyAction(data,{type:'proposal.reconsider',date,itemId:plan.items[0].id});data=applyAction(data,{type:'proposal.approve',date,itemId:plan.items[0].id});assert.equal(data.tasks.length,3);assert.equal(data.events.length,1);
 const regenerated=applyAction(data,{type:'proposal.generate',date,energy:'normal'});assert.ok(regenerated.proposals[0].brief);assert.equal(regenerated.proposals[0].items.find(i=>i.id===plan.items[0].id).state,'approved');
}));

test('completed, waiting, held and blocked tasks cannot become priorities; durations and source IDs are authoritative',()=>fixture(async db=>{
 const snapshot=await seed(db),ctx=await collectPlanningContext(db,'owner',snapshot,planning,[],env);const c=content();c.priorities[0].minutes=5;const brief=completeBrief(c,ctx,planning,snapshot.revision,randomUUID());const plan=planFromBrief(snapshot.data,brief,'normal');assert.equal(plan.brief.priorities[0].minutes,45);
 for(const patch of [{status:'done'},{status:'waiting'},{planHoldUntil:addDays(date,1)},{dependsOn:['unfinished']}]){const data=structuredClone(snapshot.data);Object.assign(data.tasks[0],patch);assert.throws(()=>planFromBrief(data,structuredClone(brief),'normal'))}
 const bad=content();bad.priorities[0].evidence=['note:invented'];assert.throws(()=>completeBrief(bad,ctx,planning,0,randomUUID()),e=>e.code==='BRIEF_EVIDENCE');
 const full=structuredClone(snapshot.data);full.events=[{id:'busy',title:'종일 회의',date,start:0,end:1440,kind:'meeting'}];assert.equal(planFromBrief(full,brief,'normal').items.length,0);
}));

test('cancel and concurrent edits atomically preserve the previous proposal and never publish a stale brief',()=>fixture(async db=>{
 let snapshot=await seed(db);await hermes(db);const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);snapshot=await readWorkspace(db,'owner');const row=await db.prepare('SELECT updated_at FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first();const ctx=await collectPlanningContext(db,'owner',snapshot,planning,[],env),brief=completeBrief(content(),ctx,planning,snapshot.revision,id);
 await db.prepare('UPDATE orbit_hermes_jobs SET cancel_requested=1 WHERE owner_id=? AND turn_id=?').bind('owner',id).run();await assert.rejects(()=>publishBrief(db,'owner',id,row.updated_at,brief,planning),e=>e.code==='CONFLICT');assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);
 await db.prepare('UPDATE orbit_hermes_jobs SET cancel_requested=0 WHERE owner_id=? AND turn_id=?').bind('owner',id).run();await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'t',status:'doing'}});await assert.rejects(()=>publishBrief(db,'owner',id,row.updated_at,brief,planning),e=>e.code==='CONFLICT');assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);
}));

test('lost atomic publish acknowledgement reconciles a completed report without a duplicate run or write',()=>fixture(async db=>{
 await seed(db);await hermes(db);globalThis.fetch=async(url,options={})=>options.method==='POST'?j({run_id:'run_1',status:'started'},202):response({kind:'brief',brief:content()});const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);await advanceAgent(db,'owner',id,env);
 const original=db.batch.bind(db);let lost=false;db.batch=async statements=>{const result=await original(statements);if(!lost&&statements.some(s=>s.sql.includes("SET status='completed',response_json"))){lost=true;throw new Error('lost ack')}return result};
 await assert.rejects(()=>advanceAgent(db,'owner',id,env),e=>e.code==='STORAGE');const before=await readWorkspace(db,'owner');assert.equal(before.data.proposals.length,1);assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first()).status,'completed');await advanceAgent(db,'owner',id,env,true);assert.equal((await readWorkspace(db,'owner')).revision,before.revision);
}));

test('legacy generation requests now start the same resumable strategic analysis',()=>fixture(async db=>{
 const snapshot=await seed(db);await hermes(db);const id=randomUUID();await startPlanningAction(db,'owner',{operationId:id,expectedRevision:snapshot.revision,action:{type:'proposal.generate',date,energy:'normal'}},env);assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',id).first();assert.equal(JSON.parse(row.job_json).planning.date,date);
}));

test('Plaud read evidence is carried into the brief instead of treating connection status as analysis',()=>fixture(async db=>{
 await seed(db);await hermes(db);await saveConnection(db,'owner','plaud',{accessToken:'test-plaud',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
 let hermesPosts=0,transcripts=0;
 globalThis.fetch=async(url,options={})=>{
  if(url.startsWith('https://mcp.plaud.ai')){const body=JSON.parse(options.body);if(body.method==='notifications/initialized')return new Response(null,{status:202});let result;
   if(body.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}}};else if(body.method==='tools/list')result={tools:[{name:'get_transcript',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']},annotations:{readOnlyHint:true}}]};else {transcripts++;assert.equal(body.params.arguments.id,'meeting-1');result={content:[{type:'text',text:'가격 조건 미결. 조건별 비교안을 다음 결정 전에 준비한다.'}]};}
   return j({jsonrpc:'2.0',id:body.id,result});
  }
  if(options.method==='POST'){hermesPosts++;if(hermesPosts===2)assert.match(JSON.parse(options.body).input,/가격 조건 미결/);return j({run_id:'run_1',status:'started'},202)}
  if(hermesPosts===1)return response({kind:'read',requests:[{tool:'plaud_read',arguments:{name:'get_transcript',arguments:{id:'meeting-1'}}}]});
  const c=content();c.priorities[0].evidence.push('plaud:0:0');return response({kind:'brief',brief:c});
 };
 const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);await complete(db,id);await advanceAgent(db,'owner',id,env);await complete(db,id);
 const brief=(await readWorkspace(db,'owner')).data.proposals[0].brief;assert.equal(transcripts,1);assert.match(brief.coverage.plaud,/조회에 성공/);assert.match(brief.evidence.find(e=>e.kind==='plaud').excerpt,/meeting-1/);
}));

test('oversized Korean planning context fails explicitly instead of looping as a storage outage',()=>fixture(async db=>{
 let snapshot=await seed(db);await hermes(db);
 for(let i=0;i<3;i++){snapshot=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:{id:'large-'+i,title:'긴 회의 '+i,kind:'meeting',projectId:'p',summary:'긴 원문',body:'가'.repeat(80000),tags:[],updated:today}}})}
 for(let i=0;i<50;i++)await db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,attachment_ids,status,response_json,created_at,updated_at) VALUES(?,?,'legacy',?,'[]','completed',?,?,?)").bind('owner',randomUUID(),'나'.repeat(4000),JSON.stringify({text:'다'.repeat(4000),sources:[]}),new Date().toISOString(),new Date().toISOString()).run();
 const id=randomUUID();await assert.rejects(()=>runAgent(db,'owner',{id,message:briefMessage(planning),planning},env),e=>e.code==='CONTEXT_SIZE');assert.equal(await db.prepare('SELECT * FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind('owner',id).first(),null);assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first()).status,'failed');
}));
