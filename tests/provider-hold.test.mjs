import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,readNote,writeCommand} from '../db/repository.ts';
import {importRecording} from '../lib/orbit/meetings/store.ts';
import {processMeetingReviews,meetingReviewDetail} from '../lib/orbit/meetings/review-runtime.ts';
import {collectNotifications,listNotifications} from '../lib/orbit/notifications/store.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {tickRuntime,runtimeStatus} from '../lib/orbit/daily-runtime.ts';
import {classifyLimit,nextCheckAt,activeHold,gateProvider,recordLimit} from '../lib/orbit/agent/provider-hold.ts';
import {aiHoldStatus} from '../lib/orbit/agent/hold-status.ts';
import {todayInZone} from '../lib/orbit/dates.ts';

const owner='hold-owner',env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const QUOTA='Codex provider quota exhausted (429); credentials are valid; retry after 393141s';
const project={id:'p',name:'피자',goal:'매장 준비',due:'2099-01-01',priority:3,color:'#7766aa',symbol:'P'};
const meetings=['m1','m2','m3'].map((id,i)=>({id,title:'회의 '+(i+1),text:`${id} 계약 조건을 정리한다.`}));

async function seed(db){
 await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:0,action:{type:'project.upsert',project}});
 for(const m of meetings)await importRecording(db,owner,{id:m.id,title:m.title,started:'2026-09-2'+m.id.slice(1),duration:5,transcript:m.text,summary:'',pending:false});
 await saveConnection(db,owner,'hermes',{endpoint:'https://hermes.example.com',token:'private-fixture-token',connectionId:'native'},{connected:true,endpoint:'https://hermes.example.com',model:'Hermes'},env.ORBIT_ENCRYPTION_KEY);
 const notes={};for(const m of meetings)notes[m.id]=await readNote(db,owner,'plaud:'+m.id);return notes;
}
const final=(note,text)=>({kind:'final',text:'회의 정보\n'+note.title+'\n안건별 요약\n계약 조건 정리.\n다음 할 일\n계약 조건 정리',proposals:[{title:text,reason:'계약 협의 준비',source:{line:note.body.split('\n').findIndex(l=>l===text)+1,quote:text},action:{type:'task.upsert',task:{title:text,projectId:'p',duration:30,due:'2099-01-02',impact:3,definition:'정리한 문서'}}}]});
// A Hermes gateway whose provider answers with the current mode: 'quota' fails every run with a spent limit.
function gateway(notes,extra=()=>null){
 const state={mode:'quota',posts:0,runs:new Map(),real:globalThis.fetch};
 globalThis.fetch=async(url,options={})=>{
  const other=extra(url,options,state);if(other)return other;
  if(!String(url).startsWith('https://hermes.example.com/v1/runs'))return Response.json({error:'not found'},{status:404});
  if(options.method==='POST'){
   state.posts++;const id='run-'+state.posts,body=JSON.parse(options.body);
   const m=/회의 정보/.test(body.instructions)?meetings.find(x=>body.input.includes('plaud:'+x.id)):null;
   state.runs.set(id,state.mode==='quota'?{status:'failed',error:QUOTA}:{status:'completed',output:JSON.stringify(m?final(notes[m.id],m.text):{kind:'final',text:'확인했습니다.',proposals:[]})});
   return Response.json({run_id:id,status:'started'},{status:202});
  }
  const id=String(url).split('/').pop();return Response.json({object:'hermes.run',run_id:id,...state.runs.get(id)});
 };
 return state;
}
const reviews=async db=>(await db.prepare('SELECT note_id,status,error,hold_id FROM orbit_meeting_reviews WHERE owner_id=? ORDER BY note_id').bind(owner).all()).results;
async function drain(db,times=8){for(let i=0;i<times;i++)await processMeetingReviews(db,owner,env)}

test('limit text is classified by kind and retry time; authentication stays separate',()=>{
 assert.deepEqual(classifyLimit(QUOTA),{kind:'quota',retryAfterMs:393141000});
 assert.deepEqual(classifyLimit('rate limit reached, retry after 20s'),{kind:'rate_limit',retryAfterMs:20000});
 assert.deepEqual(classifyLimit('429 Too Many Requests; retry-after: 2 minutes'),{kind:'rate_limit',retryAfterMs:120000});
 assert.deepEqual(classifyLimit('429 Too Many Requests'),{kind:'rate_limit'});
 assert.deepEqual(classifyLimit('usage limit reached for this plan'),{kind:'quota'});
 assert.equal(classifyLimit('authentication failed: invalid api key'),null);
 assert.equal(classifyLimit('context length exceeded'),null);
});

test('recovery checks back off with jitter and honour a known reset time',()=>{
 const half=()=>0.5,low=()=>0;
 assert.equal(nextCheckAt(0,'quota',0,undefined,half),1800000);
 assert.equal(nextCheckAt(0,'quota',1,undefined,half),3600000);
 assert.equal(nextCheckAt(0,'quota',9,undefined,half),21600000,'capped at six hours');
 assert.equal(nextCheckAt(0,'quota',0,undefined,low),1440000,'jitter spreads by ±20%');
 assert.equal(nextCheckAt(0,'rate_limit',9,undefined,half),900000);
 assert.equal(nextCheckAt(0,'quota',0,393141000,half),393141000+150000);
});

test('a spent quota stops the meeting chain after one call, keeps every record and notifies once',async()=>{const db=createDatabase();try{
 const notes=await seed(db),gw=gateway(notes);
 try{
  await processMeetingReviews(db,owner,env);
  assert.deepEqual((await reviews(db)).map(r=>r.status).sort(),['queued','queued','waiting_quota'],'the failed turn is reconciled as waiting work at once');
  await drain(db);
 }finally{globalThis.fetch=gw.real}
 assert.equal(gw.posts,1,'only the first meeting reached the provider');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM orbit_agent_turns WHERE owner_id=?').bind(owner).first()).n,1,'no new turn is started while the hold waits');
 const rows=await reviews(db);
 assert.equal(rows.length,3);assert.ok(rows.every(r=>['waiting_quota','queued'].includes(r.status)),JSON.stringify(rows));
 assert.equal(rows.filter(r=>r.status==='waiting_quota').length,1);
 assert.doesNotMatch(rows.find(r=>r.status==='waiting_quota').error,/보류/,'the waiting record is not restarted before the next check');
 const hold=await activeHold(db,owner,'hermes');
 assert.equal(hold.kind,'quota');assert.equal(hold.retryKnown,true);assert.ok(hold.nextCheckAt>Date.now()+393000000);
 assert.ok(rows.every(r=>r.hold_id===hold.id),'every affected record is tagged with the episode');
 await collectNotifications(db,owner);const inbox=(await listNotifications(db,owner)).items;
 assert.equal(inbox.filter(n=>n.title==='회의 분석 실패').length,0,JSON.stringify(inbox));
 const notice=inbox.filter(n=>n.id.startsWith('hold:'));
 assert.equal(notice.length,1);assert.equal(notice[0].title,'AI 분석 대기 중');assert.match(notice[0].body,/기존 계획과 결과 기록은 사용 가능/);
 const status=await aiHoldStatus(db,owner);
 assert.equal(status.holds.length,1);assert.equal(status.waiting.meetings.length,3);assert.deepEqual(status.waiting.meetings.map(m=>m.title).sort(),['회의 1','회의 2','회의 3']);
 assert.equal((await meetingReviewDetail(db,owner,rows.find(r=>r.status==='waiting_quota').note_id)).status,'waiting_quota');
}finally{db.close()}});

test('after the reset one probe resumes the queue in order without duplicate cards',async()=>{const db=createDatabase();try{
 const notes=await seed(db),gw=gateway(notes);
 try{
  await drain(db);const hold=await activeHold(db,owner,'hermes');
  gw.mode='ok';await drain(db,2);assert.equal(gw.posts,1,'no call before the next check time');
  await db.prepare('UPDATE orbit_provider_holds SET next_check_at=0 WHERE owner_id=?').bind(owner).run();
  await drain(db,12);
  assert.equal(gw.posts,4,'one probe, then the remaining two meetings');
  assert.equal(await activeHold(db,owner,'hermes'),null);
  const closed=await db.prepare('SELECT probes,leaked,cleared_by FROM orbit_provider_holds WHERE owner_id=? AND id=?').bind(owner,hold.id).first();
  assert.equal(closed.probes,1);assert.equal(closed.leaked,0);
  for(const m of meetings){const d=await meetingReviewDetail(db,owner,'plaud:'+m.id);assert.equal(d.status,'completed',d.error);assert.equal(d.actions.length,1)}
  await drain(db,3);assert.equal(gw.posts,4,'completed reviews are not analysed again');
  const pending=await db.prepare("SELECT count(*) AS n FROM orbit_agent_actions WHERE owner_id=? AND state='pending'").bind(owner).first();assert.equal(pending.n,3);
  await collectNotifications(db,owner);const inbox=(await listNotifications(db,owner)).items;
  assert.ok(inbox.some(n=>n.id==='hold:'+hold.id+':recovered'));assert.equal(inbox.filter(n=>n.title==='회의 분석 실패').length,0);
  const metric=(await aiHoldStatus(db,owner)).metrics.find(m=>m.id===hold.id);
  assert.equal(metric.affected,3);assert.equal(metric.completed,3);assert.equal(metric.leaked,0);assert.equal(metric.probes,1);
 }finally{globalThis.fetch=gw.real}
}finally{db.close()}});

test('a probe that meets the limit again pushes the next check back and calls nothing else',async()=>{const db=createDatabase();try{
 const notes=await seed(db),gw=gateway(notes);
 try{
  await drain(db);await db.prepare('UPDATE orbit_provider_holds SET next_check_at=0 WHERE owner_id=?').bind(owner).run();
  await drain(db);
  assert.equal(gw.posts,2);
  const hold=await activeHold(db,owner,'hermes');assert.equal(hold.failures,1);assert.equal(hold.probeTurnId,'');assert.ok(hold.nextCheckAt>Date.now());assert.equal(hold.leaked,0);
  assert.ok((await reviews(db)).every(r=>r.status!=='failed'));
 }finally{globalThis.fetch=gw.real}
}finally{db.close()}});

test('only one worker can hold the recovery probe',async()=>{const db=createDatabase();try{
 await recordLimit(db,owner,'hermes',QUOTA,{id:'first',automatic:true});
 await db.prepare('UPDATE orbit_provider_holds SET next_check_at=0').run();
 const [a,b]=await Promise.all([gateProvider(db,owner,'hermes',{id:'a',automatic:true}),gateProvider(db,owner,'hermes',{id:'b',automatic:true})]);
 assert.deepEqual([a.state,b.state].sort(),['probe','wait']);
 assert.equal((await gateProvider(db,owner,'hermes',{id:a.state==='probe'?'a':'b',automatic:true})).state,'probe','the holder keeps its slot');
 assert.equal((await gateProvider(db,owner,'hermes',{id:'manual',automatic:false})).state,'manual','a manual request is never stopped');
}finally{db.close()}});

test('earlier limit failures are revived once; a stopped review is never resumed',async()=>{const db=createDatabase();try{
 const notes=await seed(db),gw=gateway(notes);gw.mode='ok';
 try{
  const now=new Date().toISOString();
  await db.prepare("UPDATE orbit_meeting_reviews SET status='failed',error=? WHERE owner_id=? AND note_id='plaud:m1'").bind('회의 분석을 완료하지 못했습니다. 헤르메스 오류: '+QUOTA,owner).run();
  await db.prepare("UPDATE orbit_meeting_reviews SET status='failed',error='요청을 중지했습니다. quota' ,updated_at=? WHERE owner_id=? AND note_id='plaud:m2'").bind(now,owner).run();
  await drain(db,10);
  const rows=await reviews(db);
  assert.equal(rows.find(r=>r.note_id==='plaud:m1').status,'completed');
  assert.equal(rows.find(r=>r.note_id==='plaud:m2').status,'failed');
 }finally{globalThis.fetch=gw.real}
}finally{db.close()}});

test('a manual request during a hold is sent with a warning and its success ends the hold',async()=>{const db=createDatabase();try{
 const notes=await seed(db),gw=gateway(notes);gw.mode='ok';
 try{
  await recordLimit(db,owner,'hermes',QUOTA,{id:'earlier',automatic:true});
  const id=randomUUID();await runAgent(db,owner,{id,message:'오늘 할 일을 정리해 줘'},env);
  const progress=JSON.parse((await db.prepare('SELECT response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first()).response_json).progress;
  assert.match(progress,/사용량 한도/);
  for(let i=0;i<4;i++)await advanceAgent(db,owner,id,env);
  assert.equal(gw.posts,1,'the manual request was sent');
  assert.equal((await db.prepare('SELECT status FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first()).status,'completed');
  assert.equal(await activeHold(db,owner,'hermes'),null);
  assert.equal((await db.prepare('SELECT manual FROM orbit_provider_holds WHERE owner_id=?').bind(owner).first()).manual,1);
 }finally{globalThis.fetch=gw.real}
}finally{db.close()}});

test('daily planning waits during a hold without spending attempts, keeps a usable plan and resumes after recovery',async()=>{const db=createDatabase();try{
 const notes=await seed(db);let briefs=0;
 const gw=gateway(notes,(url,options,state)=>{
  if(!String(url).startsWith('https://hermes.example.com/v1/runs')||options.method!=='POST'||!/one-page executive plan/.test(JSON.parse(options.body).instructions))return null;
  state.posts++;briefs++;const id='plan-'+state.posts;
  state.runs.set(id,state.mode==='quota'?{status:'failed',error:QUOTA}:{status:'completed',output:JSON.stringify({kind:'brief',brief:{headline:'피자 매장 준비를 계약 조건 정리부터',assessment:'계약 조건 정리가 다음 관문입니다.',progress:[],priorities:[{projectId:'p',title:'계약 조건 정리',outcome:'조건 목록 한 장',whyNow:'매장 준비의 다음 단계입니다.',approach:['조건 목록 작성'],minutes:30,evidence:['project:p']}],tradeoffs:[],risks:[],success:'계약 조건 목록을 확정한다.',questions:[]}})});
  return Response.json({run_id:id,status:'started'},{status:202});
 });
 try{
  await db.prepare("DELETE FROM orbit_meeting_reviews").run();
  await db.prepare("INSERT INTO orbit_daily_runtime(owner_id,config_json,lease_until) VALUES(?,?,0)").bind(owner,JSON.stringify({enabled:true,eveningHour:21,syncAt:new Date().toISOString()})).run();
  await recordLimit(db,owner,'hermes',QUOTA,{id:'earlier',automatic:true});
  for(let i=0;i<8;i++){await tickRuntime(db,owner,env);await db.prepare('UPDATE orbit_daily_runtime SET lease_until=0').run()}
  assert.equal(briefs,0,'no planning call while the hold waits');
  let run=(await runtimeStatus(db,owner)).runs[0];
  assert.equal(run.status,'waiting_quota');assert.equal(run.attempts,0,'waiting does not spend attempts');
  assert.ok((await readWorkspace(db,owner)).data.proposals.some(p=>p.date===run.date&&!p.brief),'the rule-based plan keeps the day usable');
  const review=await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:(await readWorkspace(db,owner)).revision,action:{type:'review.save',review:{date:todayInZone('Asia/Seoul'),win:'정리함',block:'',energy:'normal'}}}).catch(e=>e);
  assert.ok(!(review instanceof Error),'reviews are still saved during a hold: '+review?.message);
  gw.mode='ok';await db.prepare('UPDATE orbit_provider_holds SET next_check_at=0 WHERE owner_id=?').bind(owner).run();
  for(let i=0;i<12;i++){await tickRuntime(db,owner,env);await db.prepare('UPDATE orbit_daily_runtime SET lease_until=0').run();const t=(await runtimeStatus(db,owner)).runs[0];if(t.status==='running')await advanceAgent(db,owner,t.id,env)}
  run=(await runtimeStatus(db,owner)).runs[0];
  assert.equal(briefs,1,'one resumed planning run');
  assert.ok((await readWorkspace(db,owner)).data.proposals.some(p=>p.date===run.date&&p.brief),'the full plan replaced the rule-based one: '+run.status);
  assert.equal(await activeHold(db,owner,'hermes'),null);
 }finally{globalThis.fetch=gw.real}
}finally{db.close()}});
