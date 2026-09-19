import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace,withDefaults} from '../lib/orbit/model.ts';
import {workEligibility} from '../lib/orbit/work-policy.ts';
import {questReadiness} from '../lib/orbit/pacemaker.ts';
import {generateProposal,approveProposalItem} from '../lib/orbit/planner.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {startPlanningAction} from '../lib/orbit/brief/start.ts';
import {tickRuntime,runtimeStatus,runtimeSettings} from '../lib/orbit/daily-runtime.ts';
import {previewRestore} from '../lib/orbit/backup.ts';
import {workspaceUsage,persistedWorkspace} from '../lib/orbit/storage-usage.ts';
import {readWorkspace} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';
const date='2026-09-21',now=new Date(date+'T01:00:00Z');
const project={id:'p',name:'Project',color:'#123456',symbol:'P',goal:'Ship',due:date,priority:4};
const task={id:'t',title:'Decision',projectId:'p',status:'todo',duration:60,due:'2026-09-25',impact:5,focus:false,definition:'Decision memo',cognition:'high',quadrant:'B'};
const data=()=>({...emptyWorkspace(),projects:[project],tasks:[task]});
const preferences=()=>({...withDefaults(emptyWorkspace().preferences),workStart:480,workEnd:1080,workDays:[0,1,2,3,4,5,6],bufferFraction:0.1,laserMinutes:180,rhythm:{peakStart:600,peakEnd:780,lunchStart:780,lunchEnd:840}});
async function fixture(fn){const db=createDatabase();try{await fn(db)}finally{db.close()}}
for(const [name,edit] of [
 ['blocker',d=>d.tasks[0].blocker='Waiting for approval'],
 ['dependency',d=>d.tasks[0].dependsOn=['missing']],
 ['hold',d=>d.tasks[0].planHoldUntil='2026-09-23'],
 ['goal',d=>{d.projects[0].goalId='g';d.goals=[{id:'g',status:'paused'}]}],
 ['allocation',d=>d.weeklyAllocations=[{active:true,from:date,through:date,allocations:[{projectId:'p',stance:'pause'}]}]],
])test('one eligibility policy blocks '+name+' in planning, approval, focus and start',()=>{
 const d=structuredClone(data());edit(d);const t=d.tasks[0];
 assert.equal(workEligibility(d,t,date).allowed,false);assert.equal(questReadiness(d,t,date).canStart,false);
 assert.equal(generateProposal(d.tasks,[],date,'normal',undefined,preferences(),{context:d}).items.length,0);
 for(const action of [{type:'task.start',id:t.id},{type:'task.focus',id:t.id,focus:true},{type:'task.laser',id:t.id,laser:true,date}])assert.throws(()=>applyAction(d,action,now));
 const p={id:'plan',date,energy:'normal',items:[{id:'i',taskId:t.id,start:600,end:660,state:'pending',estimate:60}]};d.proposals=[p];
 assert.throws(()=>applyAction(d,{type:'proposal.approve',date,itemId:'i'},now));
 if(name==='blocker')assert.ok(approveProposalItem(p,'i',d.tasks,[]).error);
});
test('a live session blocks starting another task but permits a future plan',()=>{
 const d=data();d.tasks=[task,{...task,id:'other',startedAt:now.toISOString(),status:'doing'}];
 assert.equal(workEligibility(d,task,date,'start').allowed,false);assert.equal(workEligibility(d,task,date,'plan').allowed,true);
});
test('Goal Laser occupies the actual peak intersection and keeps earlier gaps usable',()=>{
 const plan=generateProposal([{...task,duration:180},{...task,id:'small',cognition:'low',duration:30}],[],date,'normal',undefined,preferences(),{dominoProjectId:'p'});
 const laser=plan.items.find(i=>i.role==='laser'),small=plan.items.find(i=>i.taskId==='small');
 assert.equal(laser.start,600);assert.equal(laser.end,780);assert.ok(small.end<=600);
});
test('a retained approved item consumes focusLimit before Laser selection',()=>{
 const previous={id:'plan',date,energy:'normal',items:[{id:'keep',taskId:'keep',start:900,end:930,state:'approved'}]};
 const plan=generateProposal([task,{...task,id:'keep',duration:30}],[],date,'normal',previous,{...preferences(),focusLimit:1},{dominoProjectId:'p'});
 assert.equal(plan.items.length,1);assert.equal(plan.items[0].id,'keep');assert.equal(plan.laser.status,'failed');
});
test('lost fallback ACK replays before stale revision checks and rejects changed payload/type',()=>fixture(async db=>{
 const command={operationId:randomUUID(),expectedRevision:0,action:{type:'proposal.generate',date,energy:'normal'}};
 const first=await startPlanningAction(db,'a',command,{});const second=await startPlanningAction(db,'a',command,{});
 assert.equal(first.local,true);assert.equal(second.local,true);assert.equal(second.snapshot.revision,first.snapshot.revision);
 await assert.rejects(()=>startPlanningAction(db,'a',{...command,action:{...command.action,energy:'low'}},{}));
 await assert.rejects(()=>startPlanningAction(db,'a',{...command,action:{type:'review.saveGenerate',review:{date:'2026-09-20',win:'ok',block:'',energy:'normal'}}},{}));
 assert.equal((await readWorkspace(db,'a')).revision,first.snapshot.revision);
 assert.equal((await readWorkspace(db,'b')).revision,0);
}));
test('manual runtime checks cannot imitate scheduler health',()=>fixture(async db=>{
 await runtimeSettings(db,'a',{enabled:false,eveningHour:21});await tickRuntime(db,'a',{});
 assert.equal((await runtimeStatus(db,'a')).config.lastSchedulerTick,undefined);
 await tickRuntime(db,'a',{}, {scheduled:true});const scheduled=(await runtimeStatus(db,'a')).config.lastSchedulerTick;assert.ok(scheduled);
 await tickRuntime(db,'a',{});assert.equal((await runtimeStatus(db,'a')).config.lastSchedulerTick,scheduled);
}));
test('storage measurement excludes external cache and stored bodies, counts UTF-8 exactly',()=>{
 const d=data();d.notes=[{id:'n',body:'원문'.repeat(10000)}];d.events=[{id:'google:cached',title:'busy'}];
 assert.equal(workspaceUsage(d).bytes,new TextEncoder().encode(JSON.stringify(persistedWorkspace(d))).length);
 assert.ok(workspaceUsage(d).bytes<10000);assert.equal(d.notes[0].body.length,20000);
});
test('restore preview rejects oversized merged data before offering confirmation',()=>{
 const current=data();current.tasks=Array.from({length:1600},(_,i)=>({...task,id:'large'+i,title:'한'.repeat(160)}));
 const source=data();const payload={format:'orbit-backup/v2',capturedAt:now.toISOString(),data:source,noteHistory:[],reviewDetails:[]};
 assert.throws(()=>previewRestore(current,payload,[{category:'tasks',id:'t'}]),/저장 한도/);
});
