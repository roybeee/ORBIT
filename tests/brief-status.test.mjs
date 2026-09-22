import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {briefMessage} from '../lib/orbit/brief/schema.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {recordSource} from '../lib/orbit/source-status.ts';
import {beginBriefRun,finishBriefRun,readBriefRun} from '../lib/orbit/brief/runs.ts';
import {planStatus} from '../lib/orbit/brief/status.ts';
import {planSteps,localStamp,MORNING_HOUR} from '../lib/orbit/brief/status-model.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul'),date=addDays(today,1),planning={date,energy:'normal'};
// 23:00 in Seoul is after the default 21:00 evening hour, so the status targets tomorrow = `date`.
const evening=()=>new Date(today+'T23:00:00+09:00');
const project={id:'p',name:'출시',goal:'검증 가능한 출시 결정',due:addDays(date,5),priority:5,color:'#5558e8',symbol:'P'};
const task={id:'t',title:'의사결정안',projectId:'p',status:'todo',due:date,impact:3,focus:false,duration:45,definition:'결정안 한 장'};
const content=()=>({headline:'내일은 출시 결정을 가능하게 만드는 조건부터 확정',assessment:'회의에서 남은 조건과 완료된 자료를 연결해 실행 순서를 제안합니다.',progress:[{text:'자료 준비가 완료되어 다음 결정을 진행할 수 있습니다.',evidence:['task:done']}],priorities:[{projectId:'p',taskId:'t',title:'의사결정안',outcome:'판단 가능한 결정안 한 장',whyNow:'출시 목표의 다음 관문이며 회의에서 확인된 미결을 해소합니다.',approach:['완료한 자료의 쟁점 비교','조건별 결론과 대안 작성'],minutes:45,evidence:['note:n','project:p']}],tradeoffs:[],risks:[],success:'결정권자가 선택할 수 있는 조건과 대안을 정리한다.',questions:[]});
const j=(data,status=200)=>Response.json(data,{status});
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function seed(db){let n=0;const send=async(action)=>{const out=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:n,action});n=out.revision};await send({type:'project.upsert',project});await send({type:'preferences.update',preferences:{...emptyWorkspace().preferences,workDays:[0,1,2,3,4,5,6]}});await send({type:'task.upsert',task});await send({type:'task.upsert',task:{...task,id:'done',title:'출시 자료',status:'done',result:'비교자료 확정',completedOn:today}});await send({type:'note.upsert',note:{id:'n',title:'출시 회의',kind:'meeting',projectId:'p',summary:'출시 검토',body:'최종 결정: 가격 조건이 확인될 때까지 출시 확정은 보류한다. 미결: 가격 조건.',tags:[],updated:today}});await send({type:'review.save',review:{date:today,win:'비교자료 확정',block:'가격 조건 미확인',energy:'normal'}});return readWorkspace(db,'owner')}
// The seeded meeting note queues a review; settle it so only the planning run is under test.
const settled=db=>db.prepare("UPDATE orbit_meeting_reviews SET status='completed' WHERE owner_id=?").bind('owner').run();
async function hermes(db){await saveConnection(db,'owner','hermes',{endpoint:'https://hermes.example.com',token:'test-hermes-token',connectionId:'native'},{connected:true,endpoint:'https://hermes.example.com',model:'Hermes'},env.ORBIT_ENCRYPTION_KEY)}
const response=output=>j({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify(output)});
const turnRow=(db,id,status,createdAt,input='안녕')=>db.prepare("INSERT INTO orbit_agent_turns(owner_id,id,conversation_id,input,attachment_ids,status,response_json,created_at,updated_at) VALUES(?,?,?,?,'[]',?,'{}',?,?)").bind('owner',id,'c-'+id,input,status,createdAt,createdAt).run();
const metrics=()=>({version:'v1',inline:true,leaves:1,reused:0,analyzed:1,merges:0,mergeReused:0,posts:1,changes:{added:0,modified:0,deleted:0,keys:['a']}});
// Completes one inline planning run (the brief.test.mjs Hermes mock) and returns the turn id.
async function published(db){
 await seed(db);await settled(db);await hermes(db);
 globalThis.fetch=async(url,options={})=>{if(options.method==='POST')return j({run_id:'run_1',status:'started'},202);return response({kind:'brief',brief:content()})};
 const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env);await advanceAgent(db,'owner',id,env);await advanceAgent(db,'owner',id,env);
 assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first()).status,'completed');
 return id;
}

test('an empty owner reports unknown collection, idle analysis, no plan and an empty history',()=>fixture(async db=>{
 const now=new Date(today+'T10:00:00+09:00'),status=await planStatus(db,'owner',{},now);
 assert.equal(status.collection.state,'unknown');assert.equal(status.collection.lastProgressAt,null);assert.equal(status.collection.pending.total,0);
 assert.equal(status.analysis.state,'idle');assert.equal(status.plan.state,'none');assert.equal(status.history.length,0);
 assert.equal(status.now,now.toISOString());assert.equal(status.target.timeZone,'Asia/Seoul');assert.equal(status.target.eveningHour,21);
 assert.equal(status.target.afterEvening,false);assert.equal(status.target.date,today);
 const late=await planStatus(db,'owner',{},evening());assert.equal(late.target.afterEvening,true);assert.equal(late.target.date,addDays(today,1));
}));

test('collector queues, imports, quarantine, reviews and a partial mail sync are counted per owner',()=>fixture(async db=>{
 const at=new Date().toISOString(),latest='2099-01-01T00:00:00.000Z';
 await db.prepare('INSERT INTO orbit_plaud_sync(owner_id,state_json,lease_until) VALUES(?,?,0)').bind('owner',JSON.stringify({enabled:true,page:1,queue:['a','b','c'],failed:[{id:'x',error:'',retryAt:0}],pageCount:0,recent:false,backfillComplete:false,lastRecent:0,nextAt:0,lastSync:latest})).run();
 await db.prepare('INSERT INTO orbit_plaud_imports(owner_id,external_id,hash,state_json,updated_at) VALUES(?,?,?,?,?)').bind('owner','rec-1','h1',JSON.stringify({status:'pending'}),at).run();
 await db.prepare('INSERT INTO orbit_activity_sync(owner_id,state_json,lease_until) VALUES(?,?,0)').bind('owner',JSON.stringify({offset:0,enabled:true,pending:[{id:'s1'},{id:'s2'},{id:'s3'}],quarantine:Array.from({length:42},(_,i)=>({id:'q'+i,signature:'',reason:'형식 확인 필요',retryAt:0})),lastSync:'2026-01-01T00:00:00.000Z'})).run();
 for(const [i,state] of ['queued','running'].entries())await db.prepare('INSERT INTO orbit_meeting_reviews(owner_id,note_id,revision,turn_id,conversation_id,status,created_at,updated_at) VALUES(?,?,1,?,?,?,?,?)').bind('owner','note-'+i,'turn-'+i,'conv-'+i,state,at,at).run();
 await recordSource(db,'owner','google_mail',{state:'partial',detail:'최근 30일 메일 수집 진행 중 · 다음 주기에 계속'});
 const status=await planStatus(db,'owner',{});
 assert.deepEqual(status.collection.pending,{plaudQueue:3,plaudFailed:1,plaudImports:1,activityPending:3,activityQuarantined:42,meetingReviews:2,mail:1,total:53});
 assert.equal(status.collection.state,'partial');assert.equal(status.collection.lastProgressAt,latest);
 assert.deepEqual(status.collection.sources.map(s=>[s.provider,s.label,s.state]),[['google_mail','Gmail','partial']]);
 const other=await planStatus(db,'b',{});
 assert.deepEqual(other.collection.pending,{plaudQueue:0,plaudFailed:0,plaudImports:0,activityPending:0,activityQuarantined:0,meetingReviews:0,mail:0,total:0});
 assert.equal(other.collection.state,'unknown');assert.equal(other.collection.sources.length,0);
}));

test('a running analysis reports the prepare progress, its last progress time, start and basis',()=>fixture(async db=>{
 await seed(db);await settled(db);await hermes(db);globalThis.fetch=async()=>{throw new Error('the status must not call Hermes')};
 const id=randomUUID();await runAgent(db,'owner',{id,message:briefMessage(planning),planning},env,{defer:true});await advanceAgent(db,'owner',id,env);
 const turn=await db.prepare('SELECT response_json,created_at,updated_at FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first(),response=JSON.parse(turn.response_json);
 const status=await planStatus(db,'owner',env,evening()),a=status.analysis;
 assert.equal(a.state,'running');assert.equal(a.turnId,id);assert.equal(a.progress,'회의록·프로젝트·완료와 미완료 업무·회고·일정을 빠짐없이 검토합니다.');assert.equal(a.error,'');
 assert.equal(a.lastProgressAt,response.progressAt??turn.updated_at);assert.equal(a.startedAt,turn.created_at);
 assert.equal(status.plan.state,'none');assert.equal(status.plan.unconfirmed.total,0);
 // The run row is written by the runner's prepare step (I2): basis time and inline metrics.
 assert.equal(a.lastProgressAt,response.progressAt,'progressAt is stored in response_json');
 assert.match(a.basisAt??'',/^\d{4}-\d{2}-\d{2}T/);assert.equal(a.metrics?.inline,true);
}));

test('a published plan is ready with zero unconfirmed records, then counts each change after the basis',()=>fixture(async db=>{
 const id=await published(db);
 let snapshot=await readWorkspace(db,'owner');const brief=snapshot.data.proposals.find(p=>p.date===date).brief;assert.equal(brief.sourceTurnId,id);
 const run=await readBriefRun(db,'owner',id);
 let status=await planStatus(db,'owner',env,evening());
 assert.equal(status.target.date,date);assert.equal(status.analysis.state,'completed');assert.equal(status.analysis.turnId,id);
 assert.equal(status.plan.state,'ready');assert.equal(status.plan.readyAt,run?.ready_at??brief.generatedAt);assert.equal(status.plan.basisAt,run?.basis_at??brief.generatedAt);
 assert.equal(status.plan.cutoff,brief.cutoff);assert.equal(status.plan.sourceRevision,brief.sourceRevision);assert.equal(status.plan.currentRevision,snapshot.revision);
 assert.deepEqual(status.plan.unconfirmed,{workspaceRevisions:0,noteRevisions:0,conversations:0,collection:0,total:0});
 snapshot=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'t',status:'doing'}});
 status=await planStatus(db,'owner',env,evening());
 assert.equal(status.plan.unconfirmed.workspaceRevisions,1);assert.equal(status.plan.state,'stale');assert.equal(status.plan.unconfirmed.noteRevisions,0);
 snapshot=await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:{id:'n2',title:'후속 회의',kind:'meeting',projectId:'p',summary:'후속',body:'가격 조건 확인 완료.',tags:[],updated:today}}});
 status=await planStatus(db,'owner',env,evening());assert.equal(status.plan.unconfirmed.noteRevisions,1);
 await turnRow(db,randomUUID(),'completed',new Date().toISOString());
 status=await planStatus(db,'owner',env,evening());assert.equal(status.plan.unconfirmed.conversations,1);
 await turnRow(db,randomUUID(),'completed',new Date().toISOString(),briefMessage({date:addDays(date,1),energy:'normal'}));
 status=await planStatus(db,'owner',env,evening());assert.equal(status.plan.unconfirmed.conversations,1);
 // The new meeting note queued one review: shown as collection backlog, counted in total, not in staleness.
 assert.deepEqual(status.plan.unconfirmed,{workspaceRevisions:2,noteRevisions:1,conversations:1,collection:1,total:5});assert.equal(status.plan.state,'stale');
 // Run telemetry from the runner (I2): ready time, duration and the 7-day history row.
 assert.ok(run,'the runner records an orbit_brief_runs row');assert.equal(status.plan.readyAt,run.ready_at);
 assert.ok(status.plan.durationMs>=0);assert.equal(status.history[0].status,'completed');assert.equal(status.history[0].turnId,id);
 assert.equal(typeof status.history[0].readyBeforeMorning,'boolean');assert.deepEqual(status.history[0].metrics.changes.keys,[]);
}));

test('the target follows the evening hour and the morning rule compares local stamps',()=>fixture(async db=>{
 const noon=await planStatus(db,'owner',{},new Date('2026-09-22T12:00:00+09:00'));
 assert.equal(noon.target.date,'2026-09-22');assert.equal(noon.target.afterEvening,false);assert.equal(noon.target.eveningHour,21);
 const night=await planStatus(db,'owner',{},new Date('2026-09-22T22:00:00+09:00'));
 assert.equal(night.target.date,'2026-09-23');assert.equal(night.target.afterEvening,true);
 assert.equal(localStamp('2026-09-21T21:30:00Z','Asia/Seoul'),'2026-09-22T06:30');assert.equal(MORNING_HOUR,7);
 const runs=[['early','2026-09-21T17:30:00.000Z','2026-09-21T21:30:00Z'],['late','2026-09-21T17:00:00.000Z','2026-09-21T23:30:00Z']];
 for(const [id,startedAt,readyAt] of runs){await turnRow(db,id,'completed',startedAt,briefMessage({date:'2026-09-22',energy:'normal'}));await beginBriefRun(db,'owner',id,{date:'2026-09-22',startedAt,basisAt:'2026-09-21T17:00:05.000Z',sourceRevision:3,metrics:metrics(),manifest:{}});await finishBriefRun(db,'owner',id,readyAt,metrics());}
 await turnRow(db,'open','running','2026-09-22T17:00:00.000Z');await beginBriefRun(db,'owner','open',{date:'2026-09-23',startedAt:'2026-09-22T17:00:00.000Z',basisAt:'2026-09-22T17:00:05.000Z',sourceRevision:4,metrics:metrics(),manifest:{}});
 const {history}=await planStatus(db,'owner',{},new Date('2026-09-22T12:00:00+09:00'));
 assert.deepEqual(history.map(h=>[h.turnId,h.status,h.readyBeforeMorning]),[['open','running',null],['early','completed',true],['late','completed',false]]);
 assert.equal(history[1].durationMs,Date.parse('2026-09-21T21:30:00Z')-Date.parse('2026-09-21T17:30:00.000Z'));assert.equal(history[0].durationMs,null);assert.equal(history[0].readyAt,null);
 assert.deepEqual(history[1].metrics.changes,{added:0,modified:0,deleted:0,keys:[]});
 assert.equal((await planStatus(db,'owner',{},new Date('2026-10-01T12:00:00+09:00'))).history.length,0,'history is a 7-day window');
}));

test('planSteps renders the demo placeholders, the loading rows and the live status vocabulary',()=>fixture(async db=>{
 const demo=planSteps(null,true,'Asia/Seoul');assert.equal(demo.length,3);assert.ok(demo.every(s=>s.state==='idle'));assert.match(demo[0].summary,/체험 화면/);
 const loading=planSteps(null,false,'Asia/Seoul');assert.ok(loading.every(s=>s.summary==='상태 확인 중'&&s.state==='idle'));
 await published(db);await recordSource(db,'owner','google_calendar',{state:'ok',detail:'선택한 캘린더 조회 완료'});
 let status=await planStatus(db,'owner',env,evening());assert.equal(status.collection.state,'ok');
 let steps=planSteps(status,false,'Asia/Seoul');
 assert.deepEqual(steps.map(s=>s.id),['collect','analyze','plan']);
 assert.match(steps[0].summary,/수집 완료/);assert.match(steps[1].summary,/분석 완료/);assert.match(steps[2].summary,/내일 계획 준비됨/);assert.match(steps[2].detail,/반영 기준 시각/);
 const snapshot=await readWorkspace(db,'owner');await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'t',status:'doing'}});
 status=await planStatus(db,'owner',env,evening());steps=planSteps(status,false,'Asia/Seoul');
 assert.equal(steps[2].state,'stale');assert.match(steps[2].summary,/이후 변경 1건/);
}));
