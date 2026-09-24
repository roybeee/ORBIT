import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {todayInZone,addDays} from '../lib/orbit/dates.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {collectPlanningContext} from '../lib/orbit/brief/context.ts';
import {briefMessage} from '../lib/orbit/brief/schema.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {prepareBatches,batchInput,acceptAnalysis,batchInstructions,unknownCitations} from '../lib/orbit/brief/batches.ts';
import {analysisVersion,lookupAnalyses,pruneAnalyses} from '../lib/orbit/brief/cache.ts';

// Shared helpers mirror tests/brief.test.mjs (copied, not imported) plus the incremental-analysis fixtures of SPEC §9.
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const today=todayInZone('Asia/Seoul'),date=addDays(today,1),planning={date,energy:'normal'},month=today.slice(0,7);
const project={id:'p',name:'출시',goal:'검증 가능한 출시 결정',due:addDays(date,5),priority:5,color:'#5558e8',symbol:'P'};
const task={id:'t',title:'의사결정안',projectId:'p',status:'todo',due:date,impact:3,focus:false,duration:45,definition:'결정안 한 장'};
const content=()=>({headline:'내일은 출시 결정을 가능하게 만드는 조건부터 확정',assessment:'회의에서 남은 조건과 완료된 자료를 연결해 실행 순서를 제안합니다.',progress:[{text:'자료 준비가 완료되어 다음 결정을 진행할 수 있습니다.',evidence:['task:done']}],priorities:[{projectId:'p',taskId:'t',title:'의사결정안',outcome:'판단 가능한 결정안 한 장',whyNow:'출시 목표의 다음 관문이며 회의에서 확인된 미결을 해소합니다.',approach:['완료한 자료의 쟁점 비교','조건별 결론과 대안 작성'],minutes:45,evidence:['note:n','project:p']}],tradeoffs:[],risks:[],success:'결정권자가 선택할 수 있는 조건과 대안을 정리한다.',questions:[]});
const j=(data,status=200)=>Response.json(data,{status});
async function fixture(fn){const db=createDatabase(),fetch=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=fetch;db.close()}}
async function seed(db,owner='owner'){let n=0;const send=async(action)=>{const out=await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:n,action});n=out.revision};await send({type:'project.upsert',project});await send({type:'preferences.update',preferences:{...emptyWorkspace().preferences,workDays:[0,1,2,3,4,5,6]}});await send({type:'task.upsert',task});await send({type:'task.upsert',task:{...task,id:'done',title:'출시 자료',status:'done',result:'비교자료 확정',completedOn:today}});await send({type:'note.upsert',note:{id:'n',title:'출시 회의',kind:'meeting',projectId:'p',summary:'출시 검토',body:'최종 결정: 가격 조건이 확인될 때까지 출시 확정은 보류한다. 미결: 가격 조건.',tags:[],updated:today}});await send({type:'review.save',review:{date:today,win:'비교자료 확정',block:'가격 조건 미확인',energy:'normal'}});return readWorkspace(db,owner)}
async function hermes(db,owner='owner'){await saveConnection(db,owner,'hermes',{endpoint:'https://hermes.example.com',token:'test-hermes-token',connectionId:'native'},{connected:true,endpoint:'https://hermes.example.com',model:'Hermes'},env.ORBIT_ENCRYPTION_KEY)}
const refs=v=>{if(!v||typeof v!=='object')return [];return [...new Set([...(typeof v.evidence==='string'?[v.evidence]:Array.isArray(v.evidence)?v.evidence.filter(x=>typeof x==='string'):[]),...Object.values(v).flatMap(refs)])]};
const bulkNote=(i,tail='')=>({id:'bulk-'+i,title:'원문 '+i,kind:'meeting',projectId:'p',summary:'회의 원문',body:'가나다라마바사'.repeat(6000)+tail,tags:[],updated:today});
// 8 notes of 42,000 chars (3 leaf parts each) and 120 extra open tasks in project p.
async function bulk(db,{notes=8,tasks=120,sentinel={},owner='owner'}={}){
 let snapshot=await seed(db,owner);
 for(let i=0;i<notes;i++)snapshot=await writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:bulkNote(i,sentinel[i]??'')}});
 const extra=Array.from({length:tasks},(_,i)=>({...task,id:'extra-'+i,title:'기록 '+i,definition:'기존 업무 내용'}));
 await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify({...snapshot.data,tasks:[...snapshot.data.tasks,...extra]}),owner).run();
 return readWorkspace(db,owner);
}
// Hermes mock: records every POST and every analyzed part; asserts the request/input bounds of I10 on every call.
// The data excerpt makes leaf changes propagate through merges; the filler makes 36 leaf outputs exceed one part (~22K chars)
// so the fixture exercises a real merge level (13 groups: 8 note groups, project/p, four passthroughs).
const filler=' 기록에서 확인한 조건과 의존성을 함께 고려합니다.'.repeat(12);
function mock({onPart,final}={}){
 const m={posts:[],sources:[],merges:[],finals:0};let current;
 globalThis.fetch=async(url,options={})=>{
  if(options.method==='POST'){current=JSON.parse(options.body);m.posts.push({key:options.headers['Idempotency-Key'],body:current});assert.ok(current.input.length<33000,'every request stays under 33,000 chars');return j({run_id:'run_'+m.posts.length,status:'started'},202)}
  const result=data=>j({object:'hermes.run',run_id:'run_'+m.posts.length,...data});
  if(current.instructions.includes('one part of an Orbit')){
   const part=JSON.parse(current.input);
   assert.ok(!('targetDate' in part)&&!('energy' in part),'batch inputs carry no date or energy');
   const intercepted=onPart?.(part,result);if(intercepted)return intercepted;
   (part.stage==='source-analysis'?m.sources:m.merges).push({unit:part.unit,part:part.part,input:current.input});
   return result({status:'completed',output:JSON.stringify({kind:'analysis',summary:'요약 '+part.unit+' · '+JSON.stringify(part.data).slice(0,120)+filler,evidence:refs(part).slice(0,16)})});
  }
  m.finals++;assert.ok(current.input.startsWith('Planning synthesis'),'batch runs end in a synthesis request');
  assert.ok(current.input.length<32000,'synthesis input stays under 32,000 chars');
  return result({status:'completed',output:JSON.stringify({kind:'brief',brief:final?final():content()})});
 };
 return m;
}
// Drives one turn to completion; a BRIEF_EVIDENCE step discards and rethrows (runner catch block), so errors are swallowed here.
async function drive(db,id,{owner='owner',onStep}={}){
 for(let step=0;step<1500;step++){
  const row=await db.prepare('SELECT job_json FROM orbit_hermes_jobs WHERE owner_id=? AND turn_id=?').bind(owner,id).first();
  if(!row)break;
  assert.ok(Buffer.byteLength(row.job_json)<250000,'job holds only bounded state');
  await onStep?.(JSON.parse(row.job_json),step);
  try{await advanceAgent(db,owner,id,env)}catch{}
 }
 return db.prepare('SELECT id,status,response_json,created_at,updated_at FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind(owner,id).first();
}
async function run(db,target,{owner='owner',onStep,id=randomUUID()}={}){
 const request={date:target,energy:'normal'};
 await runAgent(db,owner,{id,message:briefMessage(request),planning:request},env);
 return {id,turn:await drive(db,id,{owner,onStep})};
}
const finalPost=m=>[...m.posts].reverse().find(p=>/one-page executive plan/.test(p.body.instructions));
const synthesisInput=m=>{const post=finalPost(m);return JSON.parse(post.body.input.slice(post.body.input.indexOf('\n')+1))};
const runRow=(db,id,owner='owner')=>db.prepare('SELECT * FROM orbit_brief_runs WHERE owner_id=? AND turn_id=?').bind(owner,id).first();
const metricsOf=async(db,id,owner='owner')=>JSON.parse((await runRow(db,id,owner)).metrics_json);
const cacheCount=async(db,where='',...params)=>(await db.prepare('SELECT count(*) AS n FROM orbit_analysis_cache '+where).bind(...params).first()).n;
// previousPlans are also a plans/<YYYY-MM> source unit (SPEC 3.1) and every publish adds a plan record, so a "no change" day may re-read that one small unit; the helpers below separate it from record units so every other leaf and merge is asserted to be reused and the synthesis is the only other POST.
const recordSources=m=>m.sources.filter(s=>!s.unit.startsWith('plans/'));
const planSources=m=>m.sources.filter(s=>s.unit.startsWith('plans/'));

test('first run analyzes every unit once and fills the cache',()=>fixture(async db=>{
 await bulk(db);await hermes(db);const m=mock();let total;
 const {id,turn}=await run(db,date,{onStep:job=>{total??=job.batch?.total}});
 assert.equal(turn.status,'completed',turn.response_json);
 assert.equal(m.sources.length,total);assert.equal(new Set(m.sources.map(s=>s.part)).size,total,'unique part numbers');
 assert.ok(m.merges.length>0);assert.equal(m.finals,1);
 assert.equal(await cacheCount(db,"WHERE owner_id='owner'"),m.sources.length+m.merges.length);
 assert.equal(await db.prepare('SELECT * FROM orbit_brief_parts').first(),null,'temporary rows are cleaned up');
 const brief=(await readWorkspace(db,'owner')).data.proposals[0].brief,row=await runRow(db,id),metrics=JSON.parse(row.metrics_json);
 assert.equal(row.started_at,turn.created_at);assert.ok(!Number.isNaN(Date.parse(row.basis_at)));assert.ok(row.ready_at);assert.equal(row.source_revision,brief.sourceRevision);
 assert.equal(metrics.leaves,total);assert.equal(metrics.reused,0);assert.equal(metrics.posts,m.posts.length);assert.notEqual(row.manifest_json,'');
 assert.ok(m.posts.filter(p=>/one-page executive plan/.test(p.body.instructions)).every(p=>p.body.input.length<32000));
}));

test('an unchanged workspace reuses every analysis and posts exactly one synthesis request',()=>fixture(async db=>{
 await bulk(db);await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const m=mock(),progress=[],id=randomUUID();
 const two=await run(db,addDays(date,1),{id,onStep:async()=>{progress.push(JSON.parse((await db.prepare('SELECT response_json FROM orbit_agent_turns WHERE owner_id=? AND id=?').bind('owner',id).first()).response_json).progress??'')}});
 assert.equal(two.turn.status,'completed',two.turn.response_json);
 // Nothing but the newly published plan record is re-read; no merge is re-sent; the synthesis is the only other POST.
 assert.deepEqual(recordSources(m),[]);assert.ok(planSources(m).length<=1);assert.equal(m.merges.length,0);
 assert.equal(m.posts.length,1+planSources(m).length);assert.equal(m.finals,1);
 assert.match(finalPost(m).body.instructions,/one-page executive plan/);
 const input=synthesisInput(m),metrics=await metricsOf(db,two.id);
 assert.ok(input.frame&&input.frame.availableWindows&&input.frame.preferences);assert.ok(Array.isArray(input.analyses));
 assert.equal(input.changes.modified,0);assert.equal(input.changes.deleted,0);assert.equal(input.changes.added,planSources(m).length);assert.equal(input.changes.reused,metrics.reused);
 assert.equal(metrics.reused+planSources(m).length,metrics.leaves);assert.equal(metrics.mergeReused,metrics.merges);assert.ok(metrics.reused>0);
 const plan=(await readWorkspace(db,'owner')).data.proposals.find(p=>p.date===addDays(date,1));assert.ok(plan.brief.evidence.some(e=>e.id==='note:n'));
 assert.ok(progress.some(p=>/이전 분석 \d+개 재사용/.test(p)));
 assert.equal((await runRow(db,one.id)).manifest_json,'');assert.notEqual((await runRow(db,two.id)).manifest_json,'');
}));

test('a modified note re-analyzes only its changed part and its ancestors',()=>fixture(async db=>{
 await bulk(db,{sentinel:{3:'FIRST_SENTINEL'}});await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const snapshot=await readWorkspace(db,'owner');
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.upsert',note:bulkNote(3,'SECOND_SENTINEL')}});
 const m=mock({final:()=>{const c=content();c.priorities[0].evidence.push('note:bulk-3');return c}});
 const two=await run(db,addDays(date,1));assert.equal(two.turn.status,'completed',two.turn.response_json);
 const notes=recordSources(m);
 assert.ok(notes.length>=1&&notes.length<=3,'only the changed parts of bulk-3');
 assert.ok(notes.every(s=>s.unit.startsWith('note/')&&s.unit.includes('bulk-3')));
 assert.ok(notes.some(s=>s.input.includes('SECOND_SENTINEL')));
 assert.ok(m.posts.every(p=>!p.body.input.includes('FIRST_SENTINEL')),'the old bytes never travel again');
 assert.ok(m.merges.length<=4);assert.ok(m.posts.length<=8);
 const input=synthesisInput(m);assert.equal(input.changes.modified,1);assert.ok(input.changes.keys.includes('note/bulk-3'));
 const plan=(await readWorkspace(db,'owner')).data.proposals.find(p=>p.date===addDays(date,1));
 assert.equal(plan.brief.evidence.find(e=>e.id==='note:bulk-3').revision,2);
}));

test('a deleted note never survives in any input, summary or evidence',()=>fixture(async db=>{
 await bulk(db,{sentinel:{7:'GONE_SENTINEL'}});await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const snapshot=await readWorkspace(db,'owner');
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'note.delete',id:'bulk-7'}});
 const m=mock();const two=await run(db,addDays(date,1));assert.equal(two.turn.status,'completed',two.turn.response_json);
 assert.ok(m.posts.every(p=>!p.body.input.includes('GONE_SENTINEL')&&!p.body.input.includes('note:bulk-7')));
 assert.deepEqual(recordSources(m),[]);assert.ok(m.posts.length>=1&&m.posts.length<=3);
 const input=synthesisInput(m);assert.equal(input.changes.deleted,1);assert.ok(input.changes.keys.includes('note/bulk-7'));
 const before=JSON.stringify((await readWorkspace(db,'owner')).data.proposals.filter(p=>p.brief));
 mock({final:()=>{const c=content();c.priorities[0].evidence=['note:bulk-7'];return c}});
 const three=await run(db,addDays(date,2));
 assert.equal(three.turn.status,'failed');const rejected=JSON.parse(three.turn.response_json).error;assert.match(rejected,/근거를 실제 기록에서 확인하지 못했습니다/);assert.match(rejected,/확인되지 않은 근거 1건: note:bulk-7/,'the rejection names what did not resolve');
 const after=(await readWorkspace(db,'owner')).data.proposals;
 assert.equal(JSON.stringify(after.filter(p=>p.brief)),before,'nothing published from a brief citing the deleted note');
 const fallback=after.find(p=>p.date===addDays(date,2));
 assert.ok(fallback&&!fallback.brief,'the rejected day falls back to the rule-based plan');
 assert.ok(!JSON.stringify(after).includes('bulk-7')&&!JSON.stringify(after).includes('GONE_SENTINEL'),'the deleted note is cited nowhere, including the fallback');
}));

test('a task edit re-analyzes only its project unit',()=>fixture(async db=>{
 await bulk(db);await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const snapshot=await readWorkspace(db,'owner');
 await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'t',status:'doing'}});
 const m=mock();const two=await run(db,addDays(date,1));assert.equal(two.turn.status,'completed',two.turn.response_json);
 const own=recordSources(m);
 assert.ok(own.length>=1&&own.length<=2);assert.ok(own.every(s=>s.unit.startsWith('project/p')));
 assert.ok(m.merges.length<=2);assert.equal(m.finals,1);
 assert.equal((await readWorkspace(db,'owner')).data.tasks.find(t=>t.id==='t').status,'doing');
}));

test('the synthesis receives a fresh frame and the change list',()=>fixture(async db=>{
 await bulk(db);await hermes(db);
 const setGoal=async sentence=>{const s=await readWorkspace(db,'owner');await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify({...s.data,goals:[{id:'g1',kind:'short',sentence}]}),'owner').run()};
 await setGoal('출시 결정');mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 await setGoal('출시 확정');const m=mock();const two=await run(db,addDays(date,1));assert.equal(two.turn.status,'completed',two.turn.response_json);
 assert.deepEqual(recordSources(m),[]);assert.equal(m.merges.length,0);
 const input=synthesisInput(m);
 assert.equal(input.frame.brainy.goals[0].sentence,'출시 확정');assert.ok(Array.isArray(input.frame.availableWindows));
 assert.ok(input.frame.plaudTools.every(t=>!('inputSchema' in t)));assert.ok(input.changes&&Array.isArray(input.changes.keys));
}));

test('an instruction version change invalidates and prunes the cache',()=>fixture(async db=>{
 await bulk(db);await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const snapshot=await readWorkspace(db,'owner'),ctx=await collectPlanningContext(db,'owner',snapshot,planning,[],env);
 const state=await prepareBatches(db,'owner',randomUUID(),ctx,{version:'test-v2'});
 assert.equal(state.pending.length,state.total);assert.equal(state.reused,0);
 const current=await analysisVersion(batchInstructions),now=new Date().toISOString(),stale=new Date(Date.now()-50*86400000).toISOString();
 const insert=(owner,key,version,used)=>db.prepare('INSERT OR REPLACE INTO orbit_analysis_cache(owner_id,cache_key,version,stage,unit,content,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?)').bind(owner,key,version,'source','u','{}',now,used).run();
 await insert('owner','k-old','old',now);await insert('owner','k-stale',current,stale);await insert('owner','k-fresh',current,now);await insert('other','k-other','old',stale);
 await pruneAnalyses(db,'owner',current,new Date(Date.now()-45*86400000).toISOString());
 const keys=async owner=>(await db.prepare('SELECT cache_key FROM orbit_analysis_cache WHERE owner_id=? ORDER BY cache_key').bind(owner).all()).results.map(r=>r.cache_key);
 const mine=await keys('owner');
 assert.ok(!mine.includes('k-old'));assert.ok(!mine.includes('k-stale'));assert.ok(mine.includes('k-fresh'));assert.deepEqual(await keys('other'),['k-other']);
}));

test('poisoned cache rows are rejected and replaced',()=>fixture(async db=>{
 await bulk(db);await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const doneUnit='done/'+month;
 await db.prepare('UPDATE orbit_analysis_cache SET content=? WHERE owner_id=? AND unit=?').bind(JSON.stringify({kind:'analysis',summary:'x',evidence:['note:other']}),'owner',doneUnit).run();
 const merge=await db.prepare("SELECT cache_key FROM orbit_analysis_cache WHERE owner_id='owner' AND stage='merge' ORDER BY cache_key LIMIT 1").first();
 await db.prepare('UPDATE orbit_analysis_cache SET content=? WHERE owner_id=? AND cache_key=?').bind('not json','owner',merge.cache_key).run();
 const poisoned=(await db.prepare("SELECT cache_key,created_at,last_used_at,content FROM orbit_analysis_cache WHERE owner_id='owner' AND (unit=? OR cache_key=?)").bind(doneUnit,merge.cache_key).all()).results;
 assert.equal(poisoned.length,2);
 // Observe every last_used_at touch: a poisoned key must never be in one (validation precedes touch).
 const touched=[],prepare=db.prepare.bind(db);
 db.prepare=sql=>{const statement=prepare(sql);if(/SET last_used_at=/.test(sql)){const bind=statement.bind.bind(statement);statement.bind=(...params)=>{touched.push(...JSON.parse(params[2]));return bind(...params)}}return statement};
 const m=mock();const two=await run(db,addDays(date,1));assert.equal(two.turn.status,'completed',two.turn.response_json);
 assert.deepEqual(recordSources(m).map(s=>s.unit),[doneUnit]);assert.ok(m.merges.length>=1);
 assert.equal(await cacheCount(db,"WHERE content LIKE '%note:other%'"),0);
 for(const p of poisoned){
  assert.ok(!touched.includes(p.cache_key),'poisoned row was never touched');
  const row=await db.prepare('SELECT created_at,content FROM orbit_analysis_cache WHERE owner_id=? AND cache_key=?').bind('owner',p.cache_key).first();
  assert.ok(row&&row.created_at>p.created_at&&row.content!==p.content,'replaced by a fresh validated analysis');
 }
}));

test('the cache is owner-scoped',()=>fixture(async db=>{
 await bulk(db);await hermes(db);mock();const one=await run(db,date);assert.equal(one.turn.status,'completed',one.turn.response_json);
 const ownerKeys=(await db.prepare("SELECT cache_key FROM orbit_analysis_cache WHERE owner_id='owner'").all()).results.map(r=>r.cache_key);assert.ok(ownerKeys.length>0);
 assert.equal((await lookupAnalyses(db,'other',ownerKeys)).size,0,'another owner cannot read these rows');
 await bulk(db,{owner:'other'});await hermes(db,'other');const m=mock();let total;
 const other=await run(db,date,{owner:'other',onStep:job=>{total??=job.batch?.total}});
 assert.equal(other.turn.status,'completed',other.turn.response_json);assert.equal(m.sources.length,total,'identical bytes are analyzed again for the other owner');assert.ok(m.merges.length>0);
 // Identical bytes hash to identical keys, but every row stays bound to its own owner.
 assert.equal(await cacheCount(db,"WHERE owner_id='other'"),m.sources.length+m.merges.length);
 assert.equal((await lookupAnalyses(db,'owner',ownerKeys)).size,ownerKeys.length);
 assert.equal((await metricsOf(db,other.id,'other')).reused,0);
}));

test('revalidation reuses accepted analyses',()=>fixture(async db=>{
 await bulk(db);await hermes(db);const m=mock();let written=false,revalidations=0,total;
 const {turn}=await run(db,date,{onStep:async job=>{total??=job.batch?.total;revalidations=Math.max(revalidations,job.revalidations??0);
  if(!written&&(job.batch?.completed??0)>=5){written=true;const s=await readWorkspace(db,'owner');await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:s.revision,action:{type:'task.status',id:'t',status:'doing'}})}}});
 assert.equal(turn.status,'completed',turn.response_json);assert.ok(written);assert.equal(revalidations,1);
 assert.ok(m.sources.length<=total+2,'only the changed unit is re-analyzed after revalidation');
 const data=(await readWorkspace(db,'owner')).data;assert.equal(data.tasks.find(t=>t.id==='t').status,'doing');assert.ok(data.proposals.find(p=>p.date===date)?.brief);
}));

test('gateway loss and a failed part retry only that part',()=>fixture(async db=>{
 await bulk(db);await hermes(db);let lost=false,failed=false;
 const m=mock({onPart:(part,result)=>{if(part.stage!=='source-analysis')return;if(part.part===2&&!lost){lost=true;return j({error:{message:'unknown run'}},404)}if(part.part===3&&!failed){failed=true;return result({status:'failed',error:'temporary model overload'})}}});
 const {turn}=await run(db,date);assert.equal(turn.status,'completed',turn.response_json);assert.ok(lost&&failed);
 assert.equal(new Set(m.sources.map(s=>s.part)).size,m.sources.length,'each part is analyzed once');
 assert.equal(m.posts.length,m.sources.length+m.merges.length+1+2);
}));

test('inputs are date-independent and bounded',()=>fixture(async db=>{
 await bulk(db);await hermes(db);const m=mock();const {turn}=await run(db,date);assert.equal(turn.status,'completed',turn.response_json);
 assert.ok(m.posts.length>1);
 for(const post of m.posts){
  assert.ok(post.body.input.length<33000);
  if(post.body.instructions.includes('one part of an Orbit')){const part=JSON.parse(post.body.input);assert.ok(!('targetDate' in part));assert.ok(!('energy' in part));assert.ok(['source-analysis','merge-analysis'].includes(part.stage));assert.equal(typeof part.unit,'string')}
  else assert.ok(post.body.input.slice(post.body.input.indexOf('\n')+1).length<32000);
 }
}));

test('a pre-0029 job shape still completes',()=>fixture(async db=>{
 const generation=randomUUID(),id=randomUUID();
 const fragment=i=>JSON.stringify([{path:`catalog.notes[${i}]`,value:{id:'a'+i,evidence:'note:a'+i},evidence:['note:a'+i]}]);
 for(const part of [0,1])await db.prepare('INSERT INTO orbit_brief_parts(owner_id,turn_id,generation,stage,part,content) VALUES(?,?,?,?,?,?)').bind('owner',id,generation,0,part,fragment(part)).run();
 const state={generation,stage:0,cursor:0,count:2,total:2,completed:0,retries:0};
 const first=await batchInput(db,'owner',id,state,planning);assert.equal(JSON.parse(first).targetDate,date);
 assert.equal(await acceptAnalysis(db,'owner',id,state,first,{kind:'analysis',summary:'요약 a0',evidence:['note:a0']}),null);assert.equal(state.cursor,1);
 const second=await batchInput(db,'owner',id,state,planning);
 const analyses=await acceptAnalysis(db,'owner',id,state,second,{kind:'analysis',summary:'요약 a1',evidence:['note:a1']});
 assert.equal(analyses.length,2);assert.equal(await cacheCount(db),0,'legacy jobs write no cache rows');
}));

test('batch API contract preserved',()=>fixture(async db=>{
 const snapshot=await seed(db),ctx=await collectPlanningContext(db,'owner',snapshot,planning,[],env),id=randomUUID();
 const state=await prepareBatches(db,'owner',id,ctx);
 assert.deepEqual(state.pending,Array.from({length:state.total},(_,i)=>i));assert.equal(state.cursor,0);assert.equal(state.stage,0);assert.equal(typeof state.version,'string');
 const input=await batchInput(db,'owner',id,state,planning),first=await db.prepare('SELECT content FROM orbit_brief_parts WHERE owner_id=? AND turn_id=? AND generation=? AND stage=0 AND part=0').bind('owner',id,state.generation).first();
 assert.equal(JSON.parse(input).unit,JSON.parse(first.content).key);assert.equal(JSON.parse(input).part,1);
 await assert.rejects(()=>acceptAnalysis(db,'owner',id,state,input,{kind:'analysis',summary:'거짓 근거',evidence:['note:other-owner']}),e=>e.code==='BRIEF_EVIDENCE');
 assert.equal(state.cursor,0);assert.equal(await cacheCount(db),0);
 await hermes(db);const big=await readWorkspace(db,'owner');
 await db.prepare('UPDATE orbit_workspaces SET state_json=? WHERE owner_id=?').bind(JSON.stringify({...big.data,tasks:[...big.data.tasks,...Array.from({length:200},(_,i)=>({...task,id:'b'+i,definition:'설명'.repeat(500)}))]}),'owner').run();
 const cancelled=randomUUID();await runAgent(db,'owner',{id:cancelled,message:briefMessage(planning),planning},env);await advanceAgent(db,'owner',cancelled,env,true);
 assert.equal((await readWorkspace(db,'owner')).data.proposals.length,0);assert.equal(await db.prepare('SELECT * FROM orbit_brief_parts WHERE turn_id=?').bind(cancelled).first(),null);
}));

test('a part whose analysis cites evidence outside it is re-run, not the whole analysis discarded',()=>fixture(async db=>{
 await bulk(db);await hermes(db);
 // The first source part comes back citing a record that is not in its bundle. Before this, the
 // BRIEF_EVIDENCE check ended the entire run: hours of accepted parts stayed cached but the turn failed.
 let poisoned=0,wrongShape=0;
 const m=mock({onPart:(part,result)=>{
  if(part.stage!=='source-analysis')return;
  if(!poisoned++)return result({status:'completed',output:JSON.stringify({kind:'analysis',summary:'근거를 지어낸 요약'+filler,evidence:['note:not-in-this-bundle']})});
  if(!wrongShape++)return result({status:'completed',output:JSON.stringify({kind:'read',requests:[]})});
 }});
 const {id,turn}=await run(db,date);
 assert.equal(turn.status,'completed',turn.response_json);
 assert.equal(poisoned>0&&wrongShape>0,true,'both bad replies were served');
 const metrics=await metricsOf(db,id);
 assert.equal(metrics.reused,0);
 assert.ok(metrics.leaves>0);
 // Every part is accepted exactly once, and the two rejected ones cost exactly one extra send each.
 const accepted=m.sources.map(s=>s.unit+'#'+s.part);
 assert.equal(new Set(accepted).size,accepted.length,'no part is accepted twice');
 const sourcePosts=m.posts.filter(p=>p.body.instructions.includes('one part of an Orbit')&&JSON.parse(p.body.input).stage==='source-analysis');
 assert.equal(sourcePosts.length,accepted.length+2,'exactly the two rejected parts were re-sent');
 assert.ok((await readWorkspace(db,'owner')).data.proposals.some(p=>p.date===date&&p.brief),'the plan is published');
}));

test('a rejected citation names the bundle it came from and the ids it invented',()=>fixture(async db=>{
 await bulk(db);await hermes(db);
 mock({onPart:(part,result)=>part.stage==='source-analysis'
  ?result({status:'completed',output:JSON.stringify({kind:'analysis',summary:'지어낸 근거'+filler,evidence:['note:ghost-one','note:ghost-two']})})
  :undefined});
 const {turn}=await run(db,date);
 assert.equal(turn.status,'failed');
 const error=JSON.parse(turn.response_json).error;
 assert.match(error,/묶음 .+ \(\d+\/\d+\)에 없는 근거 2건/,'the failing bundle and its position are named');
 assert.match(error,/note:ghost-one/);assert.match(error,/note:ghost-two/);
}));

test('a part that keeps failing its checks still ends the run rather than looping',()=>fixture(async db=>{
 await bulk(db);await hermes(db);
 const m=mock({onPart:(part,result)=>part.stage==='source-analysis'
  ?result({status:'completed',output:JSON.stringify({kind:'analysis',summary:'언제나 틀린 근거'+filler,evidence:['note:not-in-this-bundle']})})
  :undefined});
 const {turn}=await run(db,date);
 assert.equal(turn.status,'failed');
 assert.match(JSON.parse(turn.response_json).error,/근거가 원본 묶음과 일치하지 않습니다/);
 // Bounded: the first part is attempted three times (initial + two retries), never endlessly.
 assert.equal(recordSources(m).length,0);
 assert.equal(m.posts.filter(p=>p.body.instructions.includes('one part of an Orbit')).length,3);
}));

test('a citation the model was shown is accepted; one it never saw, or a prefix of another, is not',()=>{
 // A month bundle shows 25 events but an analysis may only carry 16 citations forward, so the ones
 // that survive only inside a summary must still be citable by the merge that reads that summary.
 const input=JSON.stringify({stage:'merge-analysis',unit:'event',part:1,total:1,data:[
  {key:'event/2026-09',summary:'9월 일정 요약 · event:aaaa-1 과 event:bbbb-2 를 포함합니다.',evidence:['event:aaaa-1']},
 ]});
 assert.deepEqual(unknownCitations(input,['event:aaaa-1']),[],'declared evidence passes');
 assert.deepEqual(unknownCitations(input,['event:bbbb-2']),[],'an id shown only in the summary passes');
 assert.deepEqual(unknownCitations(input,['event:cccc-3']),['event:cccc-3'],'an id never shown is rejected');
 // 'event:aaaa' is a prefix of 'event:aaaa-1' and must not pass on that alone.
 assert.deepEqual(unknownCitations(input,['event:aaaa']),['event:aaaa']);
 assert.deepEqual(unknownCitations(input,['event:bbbb-2','event:zzzz']),['event:zzzz']);
});
