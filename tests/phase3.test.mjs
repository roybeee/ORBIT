import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,readNote} from '../db/repository.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,validateLinks} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {weeklyCapacity,portfolioBasis,operatingSignals,meetingBrief,executiveContext} from '../lib/orbit/phase3.ts';
import {planFromBrief} from '../lib/orbit/brief/planning.ts';
import {chiefOfStaff} from '../lib/orbit/chief.ts';
import {questReadiness} from '../lib/orbit/pacemaker.ts';
import {previewRestore,restoreContent,digest} from '../lib/orbit/backup.ts';
const date='2026-09-14',now=new Date(date+'T00:00:00Z');
const project={id:'p',name:'사업',color:'#5558e8',symbol:'P',goal:'검증한 결과를 낸다',due:date,priority:4};
const task={id:'t',title:'중요한 결과',projectId:'p',status:'todo',duration:30,due:date,impact:5,focus:false,definition:'검증 완료'};
const metric={id:'m',projectId:'p',name:'매출',category:'sales',unit:'원',badDirection:'down',thresholdPercent:15,thresholdAbsolute:0,maxAgeDays:7,assignee:'담당자'};
const observation=(id,from,through,value,rest={})=>({id,metricId:'m',from,through,value,source:'확인한 원본 보고서',...rest});
function seed(){const d=emptyWorkspace();d.projects=[project];d.tasks=[task];d.preferences.workDays=[1];return d;}
function withMetric(){let d=seed();d=applyAction(d,{type:'metric.upsert',metric},now);d=applyAction(d,{type:'metric.observe',observation:observation('a','2026-08-31','2026-09-06',100)},now);return applyAction(d,{type:'metric.observe',observation:observation('b','2026-09-07','2026-09-13',70)},now);}
async function fixture(fn){const db=createDatabase();try{await fn(db)}finally{db.close()}}
async function save(db,owner,action){const s=await readWorkspace(db,owner);return writeCommand(db,owner,{operationId:randomUUID(),expectedRevision:s.revision,action},now)}
test('weekly capacity unions meetings, travel, lunch, care and family time and excludes non-workdays',()=>{
 const d=seed();d.preferences.travelMinutes=30;d.events=[{id:'e1',title:'회의',date,start:600,end:660,kind:'meeting'},{id:'e2',title:'겹친 회의',date,start:630,end:690,kind:'meeting'}];d.careRoutines=[{id:'care',title:'운동',domain:'health',minutes:60,days:[1],start:840,active:true,log:[]}];
 const cap=weeklyCapacity(d,date,[{id:'family',title:'가족',date,start:960,end:1020}],now);assert.equal(cap.free,210);assert.equal(cap.budget,168);assert.equal(cap.days.filter(d=>d.free>0).length,1);
 d.chief={checkins:[{date,energy:'low',strain:'heavy',note:'',updatedAt:now.toISOString()}]};assert.equal(weeklyCapacity(d,date,[{id:'family',title:'가족',date,start:960,end:1020}],now).budget,105);
});
test('weekly approval rejects stale previews and excess budgets; pause and care affect planner, chief and readiness',()=>{
 const d=seed(),allocations=[{projectId:'p',minutes:0,stance:'pause',reason:'다음 주 재검토'}],protectedBlocks=[{id:'rest',title:'가족',date,start:540,end:1080}];
 assert.throws(()=>applyAction(d,{type:'portfolio.approve',week:date,basis:'stale',allocations,protectedBlocks},now));
 assert.throws(()=>applyAction(d,{type:'portfolio.approve',week:date,basis:portfolioBasis(d,date),allocations:[{...allocations[0],stance:'focus',minutes:1000}],protectedBlocks:[]},now));
 const approved=applyAction(d,{type:'portfolio.approve',week:date,basis:portfolioBasis(d,date),allocations,protectedBlocks},now);
 assert.equal(questReadiness(approved,task,date).state,'paused');assert.equal(chiefOfStaff(approved,now).primary.kind,'rest');assert.equal(chiefOfStaff(approved,now).capacity,0);assert.equal(chiefOfStaff(approved,now).attention,false);
 assert.equal(applyAction(approved,{type:'proposal.generate',date,energy:'normal'},now).proposals[0].items.length,0);
 assert.throws(()=>planFromBrief(approved,{date,sourceTurnId:'x',priorities:[{projectId:'p',taskId:'t',minutes:30}]},'normal'));
 const released=applyAction(approved,{type:'portfolio.release',id:date},now);assert.equal(questReadiness(released,task,date).canStart,true);
});
test('a pending plan cannot be approved into subsequently protected time and existing events prevent conflicting protection',()=>{
 let d=seed();d=applyAction(d,{type:'proposal.generate',date,energy:'normal'},now);const item=d.proposals[0].items[0];assert.ok(item);
 d=applyAction(d,{type:'portfolio.approve',week:date,basis:portfolioBasis(d,date),allocations:[{projectId:'p',minutes:0,stance:'maintain',reason:'시간 보호'}],protectedBlocks:[{id:'r',title:'회복',date,start:item.start,end:item.end}]},now);
 assert.throws(()=>applyAction(d,{type:'proposal.approve',date,itemId:item.id},now));
 const e=seed();e.events=[{id:'e',title:'기존 회의',date,start:600,end:660,kind:'meeting'}];assert.throws(()=>applyAction(e,{type:'portfolio.approve',week:date,basis:portfolioBasis(e,date),allocations:[{projectId:'p',minutes:0,stance:'maintain',reason:'보호'}],protectedBlocks:[{id:'r',title:'회복',date,start:630,end:690}]},now));
});
test('signals compare equal non-overlapping periods, respect direction, zero baselines and freshness',()=>{
 let d=withMetric();let signal=operatingSignals(d,date)[0];assert.equal(signal.state,'attention');assert.equal(signal.percent,-30);
 assert.equal(operatingSignals(d,'2026-10-01')[0].state,'stale');assert.throws(()=>applyAction(d,{type:'metric.observe',observation:observation('c','2026-09-13','2026-09-14',100)},now));
 assert.throws(()=>applyAction(d,{type:'metric.observe',observation:observation('c','2026-09-15','2026-09-16',100)},now));
 d=applyAction(d,{type:'metric.observe',observation:observation('c',date,date,10)},now);assert.equal(operatingSignals(d,date)[0].state,'baseline');
 const zero=withMetric();zero.metricObservations[0].value=0;zero.operatingMetrics[0].badDirection='up';assert.equal(operatingSignals(zero,date)[0].state,'zero-baseline');zero.operatingMetrics[0].thresholdAbsolute=5;assert.equal(operatingSignals(zero,date)[0].state,'attention');
});
test('source re-confirmation creates an immutable correction and one follow-up per comparison',()=>{
 let d=withMetric();d.notes=[{id:'n',title:'원본',kind:'wiki',projectId:'p',summary:'',body:'원문',tags:[],updated:date,revision:2}];d.metricObservations[1].noteId='n';d.metricObservations[1].noteRevision=1;
 assert.equal(operatingSignals(d,date)[0].state,'source-changed');
 d=applyAction(d,{type:'metric.observe',observation:observation('c','2026-09-07','2026-09-13',65,{supersedesId:'b',noteId:'n',noteRevision:2})},now);assert.equal(d.metricObservations.find(o=>o.id==='b').value,70);assert.equal(operatingSignals(d,date)[0].state,'attention');
 const action={type:'signal.followup',id:randomUUID(),metricId:'m',observationId:'c',baselineId:'a',title:'매출 변동 확인',assignee:'매니저',due:date,question:'주문 구성과 취소를 확인한다'};d=applyAction(d,action,now);assert.equal(d.delegations[0].status,'requested');assert.equal(d.tasks.length,1);assert.throws(()=>applyAction(d,{...action,id:randomUUID()},now));
 d=applyAction(d,{type:'signal.resolve',id:action.id,status:'resolved',resolution:'원본 주문과 대조 완료'},now);assert.equal(d.delegations[0].status,'requested');assert.equal(d.signalFollowups[0].status,'resolved');
});
const event={id:'meeting',title:'사업 회의',date,start:600,end:660};
const finish=()=>({type:'meeting.finish',id:randomUUID(),projectId:'p',event,summary:'파일럿을 먼저 검증',changedConditions:'전면 도입은 결과 확인 후',body:'결정: 파일럿\n할 일: 실험 기준 정리\n액션: 견적 회수',decision:{choice:'파일럿 진행',rationale:'검증 후 확대',reviewDate:'2026-09-21'},actions:[{title:'실험 기준 정리',assignee:'',due:'2026-09-15',minutes:30},{title:'견적 회수',assignee:'구매 담당',due:'2026-09-16',minutes:30}]});
test('meeting results persist immutable minutes, decision and assigned actions atomically and replay safely',()=>fixture(async db=>{
 await save(db,'a',{type:'project.upsert',project});await save(db,'a',{type:'event.upsert',event:{...event,kind:'meeting'}});const before=await readWorkspace(db,'a'),action=finish(),command={operationId:randomUUID(),expectedRevision:before.revision,action};assert.ok(actionSchema.safeParse(action).success);
 const saved=await writeCommand(db,'a',command,now),record=saved.data.meetingRecords[0];assert.equal(record.projectId,'p');assert.equal(record.taskIds.length,1);assert.equal(record.delegationIds.length,1);assert.equal(saved.data.decisions[0].noteRevision,1);assert.match((await readNote(db,'a',record.noteId,1)).body,/파일럿/);
 const replay=await writeCommand(db,'a',command,now);assert.equal(replay.revision,saved.revision);await assert.rejects(()=>save(db,'a',finish()));assert.equal((await readWorkspace(db,'b')).data.meetingRecords,undefined);await assert.rejects(()=>save(db,'b',finish()));
 assert.equal(meetingBrief(saved.data,event,'p').record.id,record.id);assert.equal(saved.data.events[0].projectId,undefined); // External/unassigned event keeps its project separately.
}));
test('changed meeting event and partial invalid follow-up cannot leave a document or decision',()=>fixture(async db=>{
 await save(db,'a',{type:'project.upsert',project});await save(db,'a',{type:'event.upsert',event:{...event,kind:'meeting'}});const before=await readWorkspace(db,'a');const bad=finish();bad.actions[1].due='2026-09-01';await assert.rejects(()=>save(db,'a',bad));assert.equal((await readWorkspace(db,'a')).revision,before.revision);assert.equal((await readWorkspace(db,'a')).data.notes.length,0);
 const stale=finish();stale.event={...event,title:'옛 회의'};await assert.rejects(()=>save(db,'a',stale));
}));
test('phase three backup restores dependency closure, leaves old records alone and requires reapproval of allocation',()=>fixture(async db=>{
 let d=withMetric();const id=randomUUID();d=applyAction(d,{type:'signal.followup',id,metricId:'m',observationId:'b',baselineId:'a',title:'수치 확인',assignee:'',due:date,question:'원본 확인'},now);
 d.events=[{...event,kind:'meeting'}];d=applyAction(d,finish(),now);d=applyAction(d,{type:'portfolio.approve',week:date,basis:portfolioBasis(d,date),allocations:[{projectId:'p',minutes:30,stance:'focus',reason:'핵심 결과'}],protectedBlocks:[]},now);
 const payload={format:'orbit-backup/v2',capturedAt:now.toISOString(),data:d,noteHistory:d.notes,reviewDetails:[]};const selection=[{category:'meetingRecords',id:d.meetingRecords[0].id},{category:'signalFollowups',id},{category:'weeklyAllocations',id:date}];
 const plan=previewRestore(emptyWorkspace(),payload,selection);assert.equal(plan.next.weeklyAllocations[0].active,false);assert.equal(plan.next.metricObservations.length,2);assert.equal(plan.next.projects.length,1);assert.equal(plan.next.delegations.length,1);
 const result=await restoreContent(db,'other',payload,selection,0,randomUUID(),await digest(payload));assert.equal(result.verified,true);assert.equal(result.snapshot.data.meetingRecords[0].noteId,d.meetingRecords[0].noteId);assert.match((await readNote(db,'other',d.meetingRecords[0].noteId)).body,/검증/);
 const bad=structuredClone(payload);bad.data.metricObservations[0].from='2026-09-20';assert.throws(()=>previewRestore(emptyWorkspace(),bad,selection));
}));
test('restored observations reject cycles, overlapping periods and cross-project followups',()=>{
 const d=withMetric();d.metricObservations[0].supersedesId='b';d.metricObservations[1].supersedesId='a';assert.throws(()=>validateLinks(d));
 const x=withMetric();x.metricObservations[1].from='2026-09-05';assert.throws(()=>validateLinks(x));
 const y=withMetric();y.projects.push({...project,id:'p2'});y.tasks[0].projectId='p2';y.signalFollowups=[{id:'f',metricId:'m',observationId:'b',baselineId:'a',taskId:'t',question:'확인',status:'open',resolution:'',createdAt:now.toISOString(),updatedAt:now.toISOString()}];assert.throws(()=>validateLinks(y));
});
test('executive AI context is bounded and clearly retains observed values and follow-up status',()=>{
 const d=withMetric();for(let i=0;i<59;i++)d.operatingMetrics.push({...d.operatingMetrics[0],id:'m'+i});const c=executiveContext(d,date);assert.equal(c.operating.length,12);assert.equal(c.operatingOmitted,48);assert.equal(c.operating[0].state,'attention');assert.equal(c.operating[0].latest.value,70);
});
