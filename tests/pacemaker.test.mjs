import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {goalDashboard,questReadiness,questMap,personalContext,memoryAvailable} from '../lib/orbit/pacemaker.ts';
import {sourceRecord,noteSource,addEvidence,selectEvidence} from '../lib/orbit/agent/evidence.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,readNote} from '../db/repository.ts';
import {beginTurn,finishTurn,listAgent} from '../lib/orbit/agent/repository.ts';
import {createConversation} from '../lib/orbit/agent/conversations.ts';
import {searchPersonalConversations,personalRecordStats} from '../lib/orbit/agent/personal-records.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {runAgent,advanceAgent} from '../lib/orbit/agent/runner.ts';
import {decide} from '../lib/orbit/agent/decisions.ts';
const date='2026-09-08',now=new Date(date+'T01:00:00Z');
const goal={id:'g',kind:'short',sentence:'실제 결과',status:'active',progress:{baseline:0,current:2,target:10,unit:'개',startedOn:'2026-09-01',updatedOn:date}};
const project={id:'p',name:'목표 실행',color:'#5558e8',symbol:'O',goal:'결과',goalId:'g',due:'2026-09-30',priority:3};
const task=(id,extra={})=>({id,title:id,projectId:'p',status:'todo',duration:30,due:date,impact:3,focus:false,definition:'검증할 수 있는 결과',...extra});
const fixture=(extra={})=>({...emptyWorkspace(),goals:[goal],projects:[project],tasks:[task('a')],...extra});
const draft=(id,extra={})=>{const {status,focus,...rest}=task(id,extra);return rest};
test('goal dashboard aggregates descendants without conflating completed quests and actual outcomes',()=>{
 const data=fixture({goals:[goal,{...goal,id:'child',parentId:'g'}],projects:[project,{...project,id:'p2',goalId:'child'}],tasks:[task('a',{status:'done'}),task('b',{projectId:'p2'})]});
 const root=goalDashboard(data,date)[0];assert.equal(root.total,2);assert.equal(root.done,1);assert.equal(root.ratio,.5);assert.equal(root.goal.progress.current,2);
 const done=applyAction(data,{type:'task.status',id:'b',status:'done'},now);assert.equal(goalDashboard(done,date)[0].ratio,1);assert.deepEqual(done.goals[0],goal);
 assert.throws(()=>applyAction(data,{type:'goal.upsert',goal:{...goal,parentId:'child'}},now));
});
test('readiness and start agree for external prerequisites, holds, waits, active sessions and ancestor pauses',()=>{
 for(const patch of [{dependsOn:['external']},{planHoldUntil:'2026-09-09'},{status:'waiting'},{blocker:'자료 대기'}]){const data=fixture({tasks:[task('a',patch),task('external',{projectId:'outside'})],projects:[project,{...project,id:'outside'}]});assert.equal(questReadiness(data,data.tasks[0],date).canStart,false);assert.throws(()=>applyAction(data,{type:'task.start',id:'a'},now));}
 const active=fixture({tasks:[task('a'),task('working',{startedAt:now.toISOString(),status:'doing'})]});assert.equal(questReadiness(active,active.tasks[0],date).canStart,false);assert.throws(()=>applyAction(active,{type:'task.start',id:'a'},now));
 const paused=fixture({goals:[{...goal,status:'paused'},{...goal,id:'child',parentId:'g'}],projects:[{...project,goalId:'child'}]});assert.equal(questReadiness(paused,paused.tasks[0],date).canStart,false);assert.throws(()=>applyAction(paused,{type:'task.start',id:'a'},now));
 const dependent=fixture({tasks:[task('a',{dependsOn:['b']}),task('b',{status:'done'})]});assert.equal(questReadiness(dependent,dependent.tasks[0],date).canStart,true);assert.equal(applyAction(dependent,{type:'task.start',id:'a'},now).tasks[0].status,'doing');
});
test('quest batch is atomic, reuses canonical project name, rejects unknown dependencies, cycles, overwrites and unused projects',()=>{
 const initial=fixture(),copy=structuredClone(initial),planned={type:'quest.plan',goalId:'g',tasks:[draft('b'),draft('c',{dependsOn:['b']})]};
 const next=applyAction(initial,actionSchema.parse(planned),now);assert.equal(next.tasks.length,3);assert.equal(next.tasks[2].status,'todo');assert.deepEqual(initial,copy);
 for(const tasks of [[draft('b',{dependsOn:['missing']})],[draft('b',{dependsOn:['c']}),draft('c',{dependsOn:['b']})],[draft('a')]])assert.throws(()=>applyAction(initial,{...planned,tasks},now));
 const canonical=applyAction(initial,{...planned,project:{...project,id:'draft'},tasks:[draft('b',{projectId:'draft'})]},now);assert.equal(canonical.projects.length,1);assert.equal(canonical.tasks[1].projectId,'p');
 assert.throws(()=>applyAction(initial,{...planned,project:{...project,id:'new',name:'unused'}},now));assert.deepEqual(initial,copy);
});
test('dependency graph bounds all nodes including external stubs, while readiness retains omitted blockers',()=>{
 const tasks=Array.from({length:36},(_,i)=>task('v'+i,{dependsOn:Array.from({length:30},(_,j)=>'external'+i+'_'+j)})),data=fixture({tasks});const graph=questMap(data,tasks);assert.ok(graph.nodes.length<=48);assert.equal(graph.omittedPrerequisites,1068);assert.match(questReadiness(data,tasks[0],date).reason,/선행/);
});
test('confirmed memory pins note revisions and task/review content; saju cannot become objective memory',()=>{
 const note={id:'n',title:'원문',kind:'wiki',projectId:'p',body:'본문',summary:'요약',tags:[],updated:date,revision:1};
 let data=fixture({notes:[note],reviews:[{date,energy:'normal',win:'완료',block:''}]});
 const action={type:'memory.upsert',memory:{id:'m',statement:'작은 단계로 시작',kind:'strategy',origin:'records',sources:[{kind:'note',id:'n',revision:1},{kind:'task',id:'a'},{kind:'review',id:date}]}};
 data=applyAction(data,actionSchema.parse(action),now);assert.equal(personalContext(data,date).confirmed.length,1);
 for(const mutate of [d=>d.notes[0].revision++,d=>d.tasks[0].definition='다른 결과',d=>d.reviews[0].block='조건 변화',d=>d.notes=[]]){const changed=structuredClone(data);mutate(changed);assert.equal(memoryAvailable(changed,changed.memories[0]),false);assert.equal(personalContext(changed,date).confirmed.length,0);assert.equal(personalContext(changed,date).needsReview.length,1);}
 const saju=structuredClone(data);saju.notes[0].tags=['사주'];assert.throws(()=>applyAction(saju,action,now));assert.equal(actionSchema.safeParse({...action,memory:{...action.memory,origin:'saju'}}).success,false);
 const reflection=applyAction(saju,{...action,memory:{...action.memory,origin:'saju',kind:'reflection'}},now);assert.equal(personalContext(reflection,date).confirmed.length,0);assert.equal(personalContext(reflection,date).reflection.length,1);
 assert.equal(applyAction(data,{type:'memory.delete',id:'m'},now).memories.length,0);
});
test('learning separates observed median from bounded planning factor and excludes future and undated outcomes',()=>{
 const measured=Array.from({length:5},(_,i)=>task('d'+i,{status:'done',outcome:'done',actualMinutes:120,completedOn:date}));
 const data=fixture({tasks:[...measured,task('future',{status:'done',outcome:'done',actualMinutes:1,completedOn:'2026-09-09'}),task('unmeasured',{status:'done'}),task('old',{outcome:'skipped',outcomeReason:'scope',due:date}),task('dated',{outcome:'partial',outcomeReason:'energy',outcomeOn:date})]});
 const learning=personalContext(data,date).learning;assert.equal(learning.samples,5);assert.equal(learning.median,4);assert.equal(learning.factor,2);assert.deepEqual(learning.topFriction.taskIds,['dated']);assert.equal(personalContext({...data,tasks:measured.slice(0,4)},date).learning.factor,null);
 const recorded=applyAction(fixture(),{type:'task.record',id:'a',outcome:'partial',reason:'scope',actualMinutes:20},now);assert.equal(recorded.tasks[0].outcomeOn,date);
});
test('selected evidence is bounded to actual reads and full note scope survives metadata search',()=>{
 const registry={},note={id:'n',title:'원문',body:'본문',summary:'요약',revision:2,updated:date};addEvidence(registry,[noteSource(note,true)]);addEvidence(registry,[noteSource(note,false),sourceRecord('task','a','할 일','내용')]);assert.equal(registry['note:n:v2'].scope,'full');assert.equal(selectEvidence(registry,['note:n:v2','note:n:v2']).length,1);assert.throws(()=>selectEvidence(registry,['not-read']));assert.deepEqual(selectEvidence(registry,[]),[]);
});
test('personal conversation search and counters isolate owners, escape literal wildcards, and separate AI claims',async()=>{
 const db=createDatabase();try{for(const owner of ['a','b']){const c=await createConversation(db,owner,{id:randomUUID(),title:'기록',projectId:null}),id=randomUUID(),lease=await beginTurn(db,owner,id,owner+' 사용자 100% _ 확인',c.id);await finishTurn(db,owner,id,lease.lease,{text:owner+' AI의 추측',sources:[]},[]);}
 const result=await searchPersonalConversations(db,'a','100%');assert.equal(result.length,1);assert.match(result[0].user,/a 사용자/);assert.match(result[0].assistant,/a AI/);assert.ok(!JSON.stringify(result).includes('b 사용자'));assert.equal((await searchPersonalConversations(db,'a','NOT%')).length,0);assert.equal((await personalRecordStats(db,'a')).turns,1);assert.equal((await personalRecordStats(db,'unknown')).turns,0);
 }finally{db.close()}
});
test('memory approval persists exactly once and source updates require reconfirmation across reloads',async()=>{
 const db=createDatabase();try{let state=await readWorkspace(db,'a');state=await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'project.upsert',project:{...project,goalId:undefined}}});state=await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'task.upsert',task:task('a')}});
 const id=randomUUID(),lease=await beginTurn(db,'a',id,'이 방식을 기억'),card={id:randomUUID(),turnId:id,title:'기억',reason:'사용자가 확인',action:{type:'memory.upsert',memory:{id:'m',statement:'구체적인 기준부터',kind:'strategy',origin:'records',sources:[{kind:'task',id:'a'}]}},expectedRevision:state.revision,state:'pending',note:'',revisitDate:null,createdAt:now.toISOString()};
 await finishTurn(db,'a',id,lease.lease,{text:'확인해 주세요',sources:[]},[card]);assert.equal((await readWorkspace(db,'a')).data.memories,undefined);await assert.rejects(()=>decide(db,'b',{id:card.id,decision:'approve'},{}));await decide(db,'a',{id:card.id,decision:'approve'},{});await decide(db,'a',{id:card.id,decision:'approve'},{});state=await readWorkspace(db,'a');assert.equal(state.data.memories.length,1);assert.equal((await readWorkspace(db,'b')).data.memories,undefined);
 state=await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:state.revision,action:{type:'task.status',id:'a',status:'done'}});assert.equal(personalContext(state.data,date).confirmed.length,0);
 }finally{db.close()}
});
test('imported personal text retains immutable owner-private note body and explicit reflection tags',async()=>{
 const db=createDatabase();try{const note={id:'source',title:'자기 탐색',kind:'wiki',projectId:'p',body:'사용자가 제공한 해석',summary:'자기 탐색 참고',tags:['사주'],updated:date};await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:0,action:{type:'wiki.import',project:{...project,goalId:undefined},notes:[note]}});assert.equal((await readWorkspace(db,'a')).data.notes[0].body,'');assert.equal((await readNote(db,'a','source',1)).body,note.body);await assert.rejects(()=>readNote(db,'b','source',1));}finally{db.close()}
});
test('native Hermes uses confirmed personal context and stores only explicitly selected source IDs',async()=>{
 const db=createDatabase(),original=globalThis.fetch,env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};try{await saveConnection(db,'a','hermes',{endpoint:'https://hermes.example.test',token:'test-secret',connectionId:'test'},{connected:true},env.ORBIT_ENCRYPTION_KEY);await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:0,action:{type:'memory.upsert',memory:{id:'m',statement:'오전에는 작은 실행부터',kind:'preference',origin:'user',sources:[]}}});
 for(const evidence of [['memory:m'],undefined]){globalThis.fetch=async(_url,options)=>{if(options.method==='POST'){const payload=JSON.parse(options.body);assert.match(payload.input,/오전에는 작은 실행부터/);assert.match(payload.input,/memory:m/);return Response.json({run_id:'run_1',status:'started'},{status:202})}return Response.json({object:'hermes.run',run_id:'run_1',status:'completed',output:JSON.stringify({kind:'final',text:'작은 실행부터 시작합니다.',proposals:[],...(evidence?{evidence}:{})})})};const id=randomUUID();await runAgent(db,'a',{id,message:'다음 행동'},env);await advanceAgent(db,'a',id,env);await advanceAgent(db,'a',id,env);const turn=(await listAgent(db,'a')).turns.find(t=>t.id===id);assert.equal(turn.status,'completed');assert.equal(turn.sources.length,evidence?1:0);}
 }finally{globalThis.fetch=original;db.close()}
});
