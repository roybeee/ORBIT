import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {projectTrashPreview} from '../lib/orbit/project-trash.ts';
import {createProjectPressController,PROJECT_HOLD_MS} from '../lib/orbit/project-press.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote,RevisionConflict} from '../db/repository.ts';
import {changeData,listDataTrash} from '../db/data-manager.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
const now=new Date('2026-09-19T13:00:00Z');
const project={id:'p',name:'관리할 프로젝트',goal:'검토한 최종안 전달',due:'2026-09-30',color:'#7451dc',symbol:'P',priority:3};
const task={id:'t',projectId:'p',title:'초안 작성',definition:'초안 전달',status:'todo',focus:false,due:'2026-09-30',duration:30,impact:3};
const note={id:'n',projectId:'p',title:'회의 원문',kind:'meeting',summary:'회의',body:'보존할 원문',updated:'2026-09-19',tags:[]};
const event={id:'e',projectId:'p',title:'검토 회의',date:'2026-09-30',start:600,end:630,kind:'meeting'};
const seed=()=>({...emptyWorkspace(),projects:[project,{...project,id:'other'}],tasks:[task],notes:[note],events:[event]});
const command=(revision,action)=>({operationId:randomUUID(),expectedRevision:revision,action});
function pressTest(t){t.mock.timers.enable({apis:['setTimeout','Date'],now});const opened=[],armed=[];let disabled=false;const controller=createProjectPressController({disabled:()=>disabled,onArm:id=>armed.push(id),onOpen:id=>opened.push(id)});return{controller,opened,armed,disable:()=>disabled=true}}

test('project long press arms after a hold and only opens management after the initiating pointer releases',t=>{
 const {controller:c,opened,armed}=pressTest(t);c.begin('p',20,40,1);t.mock.timers.tick(PROJECT_HOLD_MS-1);assert.deepEqual(opened,[]);assert.equal(armed.at(-1),null);
 t.mock.timers.tick(1);assert.equal(armed.at(-1),'p');assert.deepEqual(opened,[]);assert.equal(c.end(2),false);assert.equal(c.end(1),true);assert.deepEqual(opened,['p']);assert.equal(c.suppressClick(),true);
 t.mock.timers.tick(801);assert.equal(c.suppressClick(),false);
});
test('tap, scroll motion, cancellation and disabled input cannot open a project management menu',t=>{
 const {controller:c,opened,disable}=pressTest(t);
 c.begin('p',20,40,1);t.mock.timers.tick(100);c.end(1);
 c.begin('p',20,40,1);c.move(20,55,1);t.mock.timers.tick(PROJECT_HOLD_MS);c.end(1);
 c.begin('p',20,40,1);c.cancel();t.mock.timers.tick(PROJECT_HOLD_MS);c.end(1);
 c.begin('p',20,40,1);disable();t.mock.timers.tick(PROJECT_HOLD_MS);c.end(1);assert.deepEqual(opened,[]);
});
test('moving after the hold, or canceling for a second finger, still cancels the action',t=>{
 const {controller:c,opened}=pressTest(t);c.begin('p',0,0,1);t.mock.timers.tick(PROJECT_HOLD_MS);c.move(20,0,1);c.end(1);
 c.begin('p',0,0,1);t.mock.timers.tick(PROJECT_HOLD_MS);c.cancel();c.end(1);assert.deepEqual(opened,[]);
});
test('project trash preview selects only its own work and counts what the confirmation will remove',()=>{
 const data=seed();const plan=projectTrashPreview(data,'p');assert.equal(plan.error,'');assert.deepEqual(plan.counts,{tasks:1,notes:1,events:1,decisions:0,delegations:0});assert.equal(plan.selection.length,4);assert.equal(plan.selection.some(s=>s.id==='other'),false);assert.equal(data.projects.length,2);
});
test('references from another project block deletion without recursively selecting that project',()=>{
 const data=seed();data.tasks.push({...task,id:'outside',projectId:'other',dependsOn:['t']});const plan=projectTrashPreview(data,'p');assert.match(plan.error,/다른 기록/);assert.equal(plan.selection.some(s=>s.id==='outside'),false);
});
test('approved and external calendar records, live sessions and oversized projects are actionable blockers',()=>{
 for(const prefix of ['google:','approved:']){const data=seed();data.events[0]={...event,id:prefix+'e'};assert.ok(projectTrashPreview(data,'p').error);}
 const running=seed();running.tasks=[{...task,startedAt:now.toISOString()}];assert.match(projectTrashPreview(running,'p').error,/집중/);
 const large=seed();large.tasks=Array.from({length:101},(_,i)=>({...task,id:'t'+i}));assert.match(projectTrashPreview(large,'p').error,/100개/);
});
test('advanced records with project references are never silently removed or left dangling',()=>{
 const data=seed();data.risks=[{id:'risk',projectId:'p',title:'연결 리스크',probability:3,impact:3,response:'확인',trigger:'변경',owner:'본인'}];
 assert.ok(projectTrashPreview(data,'p').error);assert.equal(data.risks.length,1);
});
test('project deadline and status update together while preserving milestones and existing tasks',()=>{
 const data=seed();data.projects[0]={...project,milestones:[{id:'m',title:'초안',due:'2026-09-30',done:false,taskIds:['t']}]};
 const next=applyAction(data,{type:'project.manage',id:'p',status:'paused',due:'2026-10-07',priority:3,goalId:null,result:''},now);
 assert.equal(next.projects[0].due,'2026-10-07');assert.equal(next.projects[0].status,'paused');assert.equal(next.tasks[0].due,'2026-09-30');assert.equal(next.projects[0].milestones.length,1);
});
test('project trash and undo preserve notes and stages, isolate owners, and replay a lost response exactly once',async()=>{
 const db=createDatabase();try{
  let state=await readWorkspace(db,'owner');const write=async action=>state=await writeCommand(db,'owner',command(state.revision,action),now);
  await write({type:'project.upsert',project});await write({type:'task.upsert',task});await write({type:'note.upsert',note});await write({type:'event.upsert',event});
  await write({type:'project.milestone.upsert',id:'p',milestone:{id:'m',title:'초안',due:'2026-09-30',done:false,taskIds:['t']}});await write({type:'project.next-task',id:'p',taskId:'t'});
  const preview=projectTrashPreview(state.data,'p');assert.equal(preview.error,'');const request={...command(state.revision,'trash'),selection:preview.selection};
  const deleted=await changeData(db,'owner',request,now);assert.equal(deleted.trashIds.length,4);assert.equal(deleted.snapshot.data.projects.length,0);assert.equal((await listDataTrash(db,'owner')).total,4);
  const replay=await changeData(db,'owner',request,now);assert.equal(replay.snapshot.revision,deleted.snapshot.revision);assert.deepEqual(replay.trashIds,deleted.trashIds);
  await assert.rejects(()=>changeData(db,'other',{...command(0,'restore'),trashIds:deleted.trashIds},now));
  const restored=await changeData(db,'owner',{...command(deleted.snapshot.revision,'restore'),trashIds:deleted.trashIds},now);
  assert.equal(restored.snapshot.data.projects[0].nextTaskId,'t');assert.deepEqual(restored.snapshot.data.projects[0].milestones[0].taskIds,['t']);assert.equal((await readNote(db,'owner','n')).body,'보존할 원문');assert.equal((await listDataTrash(db,'owner')).total,0);
 }finally{db.close()}
});
test('a stale delete and an undo with a newly conflicting event both leave current work unchanged',async()=>{
 const db=createDatabase();try{
  let state=await writeCommand(db,'owner',command(0,{type:'project.upsert',project}),now);
  const stale={...command(state.revision,'trash'),selection:[{category:'projects',id:'p'}]};
  state=await writeCommand(db,'owner',command(state.revision,{type:'event.upsert',event}),now);
  await assert.rejects(()=>changeData(db,'owner',stale,now),RevisionConflict);
  const deleted=await changeData(db,'owner',{...command(state.revision,'trash'),selection:projectTrashPreview(state.data,'p').selection},now);
  state=await writeCommand(db,'owner',command(deleted.snapshot.revision,{type:'event.upsert',event:{...event,id:'conflict',projectId:undefined}}),now);
  await assert.rejects(()=>changeData(db,'owner',{...command(state.revision,'restore'),trashIds:deleted.trashIds},now));
  const fresh=await readWorkspace(db,'owner');assert.equal(fresh.revision,state.revision);assert.equal(fresh.data.projects.length,0);assert.equal(fresh.data.events[0].id,'conflict');assert.equal((await listDataTrash(db,'owner')).total,2);
 }finally{db.close()}
});
