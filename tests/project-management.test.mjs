import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,validateLinks,DomainError} from '../lib/orbit/reducer.ts';
import {actionSchema,projectSchema} from '../lib/orbit/validation.ts';
import {projectSummary,projectStatus} from '../lib/orbit/project-management.ts';
import {goalAllowsWork,workEligibility} from '../lib/orbit/work-policy.ts';
import {previewRestore} from '../lib/orbit/backup.ts';
import {planDataTrash} from '../lib/orbit/data-manager.ts';
import {automaticProject} from '../lib/orbit/classify.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,RevisionConflict} from '../db/repository.ts';
const today='2026-09-21',now=new Date(today+'T00:30:00Z');
const project={id:'p',name:'아틀라스 출시',goal:'검토한 결과물을 전달한다',due:'2026-09-24',color:'#7451dc',symbol:'A',priority:3};
const task={id:'a',title:'초안 작성',projectId:'p',status:'todo',duration:30,due:today,impact:3,focus:false,definition:'초안 전달'};
const milestone={id:'m',title:'초안 완성',due:today,done:false,taskIds:['a']};
const seed=()=>({...emptyWorkspace(),projects:[structuredClone(project),{...project,id:'q',name:'다른 프로젝트'}],tasks:[structuredClone(task),{...task,id:'b',title:'최종 검토',due:'2026-09-23'},{...task,id:'other',projectId:'q'}]});
const manage=(status,result='')=>({type:'project.manage',id:'p',status,priority:4,goalId:null,result});
const run=(data,action)=>applyAction(data,actionSchema.parse(action),now);
const withStage=()=>run(seed(),{type:'project.milestone.upsert',id:'p',milestone});

test('legacy project edits preserve management metadata and keep existing optional-field clearing semantics',()=>{
 let data=withStage();data=run(data,{type:'project.next-task',id:'p',taskId:'a'});data=run(data,manage('paused'));
 data=run(data,{type:'project.upsert',project:{...project,name:'수정 제목'}});
 assert.equal(projectStatus(data.projects[0]),'paused');assert.equal(data.projects[0].nextTaskId,'a');assert.deepEqual(data.projects[0].milestones,[milestone]);
 const changed=run(data,{type:'project.upsert',project:{...project,keywords:['신규']}});assert.deepEqual(changed.projects[0].keywords,['신규']);
 assert.equal(projectSchema.safeParse(changed.projects[0]).success,true);
});
test('stages and next actions reject foreign, missing, duplicate and completed task references',()=>{
 const data=withStage();
 for(const ids of [['other'],['missing'],['a','a']])assert.throws(()=>run(data,{type:'project.milestone.upsert',id:'p',milestone:{...milestone,taskIds:ids}}));
 assert.throws(()=>run(data,{type:'project.milestone.upsert',id:'p',milestone:{...milestone,id:'m2'}}),DomainError);
 for(const taskId of ['other','missing'])assert.throws(()=>run(data,{type:'project.next-task',id:'p',taskId}),DomainError);
 assert.throws(()=>run(data,{type:'project.upsert',project:{...project,milestones:[{...milestone,taskIds:['missing']}]}}),DomainError);
 const done=run(data,{type:'task.status',id:'a',status:'done'});assert.throws(()=>run(done,{type:'project.next-task',id:'p',taskId:'a'}),DomainError);
 assert.deepEqual(data.projects[0].milestones,[milestone]);
});
test('task stage changes move membership once and stage deletion preserves tasks',()=>{
 let data=run(withStage(),{type:'project.milestone.upsert',id:'p',milestone:{...milestone,id:'m2',taskIds:[]}});
 data=run(data,{type:'project.task-stage',id:'p',taskId:'a',milestoneId:'m2'});
 assert.deepEqual(data.projects[0].milestones.map(m=>m.taskIds),[[],['a']]);
 data=run(data,{type:'project.milestone.delete',id:'p',milestoneId:'m2'});
 assert.equal(data.tasks.length,3);assert.equal(data.projects[0].milestones.length,1);
});
test('stage completion requires finished linked tasks; reopening work reopens its stage and completion clears a next-action pin',()=>{
 let data=withStage();assert.throws(()=>run(data,{type:'project.milestone.upsert',id:'p',milestone:{...milestone,done:true}}),DomainError);
 data=run(data,{type:'project.next-task',id:'p',taskId:'a'});data=run(data,{type:'task.status',id:'a',status:'done'});
 assert.equal(data.projects[0].nextTaskId,undefined);data=run(data,{type:'project.milestone.upsert',id:'p',milestone:{...milestone,done:true}});
 data=run(data,{type:'task.status',id:'a',status:'todo'});assert.equal(data.projects[0].milestones[0].done,false);
 const invalid=withStage();invalid.projects[0].milestones[0].done=true;assert.throws(()=>validateLinks(invalid),DomainError);
});
test('task reassignment, deletion and data trash remove stale stage and next-action links',()=>{
 const pinned=run(withStage(),{type:'project.next-task',id:'p',taskId:'a'});
 for(const next of [run(pinned,{type:'task.upsert',task:{...task,projectId:'q'}}),run(pinned,{type:'task.delete',id:'a'}),planDataTrash(pinned,[{category:'tasks',id:'a'}]).next]){
  assert.deepEqual(next.projects[0].milestones[0].taskIds,[]);assert.equal(next.projects[0].nextTaskId,undefined);validateLinks(next);
 }
});
test('stage limits are enforced for incremental commands as well as full record validation',()=>{
 const data=seed();data.projects[0].milestones=Array.from({length:30},(_,i)=>({...milestone,id:'m'+i,taskIds:[]}));
 assert.throws(()=>run(data,{type:'project.milestone.upsert',id:'p',milestone:{...milestone,id:'overflow',taskIds:[]}}),DomainError);
 data.tasks=Array.from({length:501},(_,i)=>({...task,id:'t'+i}));data.projects[0].milestones=[{...milestone,taskIds:data.tasks.slice(0,500).map(t=>t.id)}];
 assert.throws(()=>run(data,{type:'project.task-stage',id:'p',taskId:'t500',milestoneId:'m'}),DomainError);
});
test('legacy projects remain active and next action respects readiness before a manual pin',()=>{
 let data=seed();assert.equal(projectStatus(data.projects[0]),'active');
 data=run(data,{type:'project.next-task',id:'p',taskId:'b'});assert.equal(projectSummary(data,data.projects[0],today).next.id,'b');
 data.tasks.find(t=>t.id==='b').blocker='회신 대기';assert.equal(projectSummary(data,data.projects[0],today).next.id,'a');
 assert.equal(projectSummary(data,data.projects[0],today).waiting.length,1);
 const noTasks=seed();noTasks.tasks=[];assert.equal(projectSummary(noTasks,noTasks.projects[0],today).progress,null);assert.equal(projectSummary(noTasks,noTasks.projects[0],today).attention,true);
});
test('planned, paused and completed projects cannot enter new plans or start focus work',()=>{
 for(const status of ['planned','paused','completed']){
  let data=run(seed(),manage(status,status==='completed'?'최종 전달 확인':''));
  assert.equal(goalAllowsWork(data,'p'),false);assert.equal(workEligibility(data,data.tasks[0],today).allowed,false);
  assert.throws(()=>run(data,{type:'task.focus',id:'a',focus:true}),DomainError);
  assert.throws(()=>run(data,{type:'task.upsert',task:{...task,focus:true,focusDate:today}}),DomainError);
  data=run(data,{type:'proposal.generate',date:today,energy:'normal'});
  assert.equal(data.proposals[0].items.some(i=>['a','b'].includes(i.taskId)),false);
  data=run(data,manage('active'));assert.equal(goalAllowsWork(data,'p'),true);assert.equal(workEligibility(data,data.tasks[0],today).allowed,true);
 }
});
test('suspending a project records elapsed work, releases focus and laser, and retains approved calendar blocks',()=>{
 let data=seed();data.preferences.focusLimit=1;data.tasks[0]={...task,status:'doing',focus:true,focusDate:today,laserDate:today,startedAt:today+'T00:10:00Z'};
 data.events=[{id:'approved:keep',title:'초안 작성',date:today,start:600,end:630,kind:'focus',projectId:'p',taskId:'a'}];
 data=run(data,manage('paused'));
 assert.equal(data.tasks[0].actualMinutes,20);assert.equal(data.tasks[0].startedAt,undefined);assert.equal(data.tasks[0].focus,false);assert.equal(data.tasks[0].laserDate,undefined);assert.equal(data.events.length,1);
 data=run(data,{type:'task.focus',id:'other',focus:true});assert.equal(data.tasks[2].focus,true);
});
test('project completion is explicit, records a result and never marks unfinished tasks done',()=>{
 assert.throws(()=>run(seed(),manage('completed','  ')),DomainError);
 const data=run(seed(),manage('completed','최종안 전달 및 확인'));
 assert.equal(data.projects[0].completedOn,today);assert.equal(data.projects[0].result,'최종안 전달 및 확인');assert.equal(data.tasks[0].status,'todo');
 const reopened=run(data,manage('active','최종안 전달 및 확인'));assert.equal(reopened.projects[0].completedOn,undefined);
});
test('project-only and task-only backup selections restore the stage dependency closure',()=>{
 let data=withStage();data.projects[0].milestones[0].taskIds.push('b');data=run(data,{type:'project.next-task',id:'p',taskId:'a'});
 const payload={format:'orbit-backup/v2',capturedAt:now.toISOString(),data,noteHistory:[],reviewDetails:[]};
 for(const selection of [[{category:'projects',id:'p'}],[{category:'tasks',id:'a'}]]){
  const restored=previewRestore(emptyWorkspace(),payload,selection).next;assert.equal(restored.projects.length,1);assert.equal(restored.tasks.length,2);assert.deepEqual(restored.projects[0].milestones,data.projects[0].milestones);assert.equal(restored.projects[0].nextTaskId,'a');validateLinks(restored);
 }
});
test('automatic assignment does not send new work into completed projects',()=>{
 const active={...project,keywords:['아틀라스']};assert.equal(automaticProject('아틀라스 최종안 전달',[active])?.projectId,'p');
 assert.equal(automaticProject('아틀라스 최종안 전달',[{...active,status:'completed',result:'전달'}]),undefined);
});
test('new project management commands persist through D1 reads, retries, conflicts and owner isolation',async()=>{
 const db=createDatabase();try{
  let state=await readWorkspace(db,'alice');const write=async action=>state=await writeCommand(db,'alice',{expectedRevision:state.revision,operationId:randomUUID(),action:actionSchema.parse(action)},now);
  await write({type:'project.upsert',project});await write({type:'task.upsert',task});await write({type:'project.milestone.upsert',id:'p',milestone});await write({type:'project.next-task',id:'p',taskId:'a'});
  const command={expectedRevision:state.revision,operationId:randomUUID(),action:manage('paused')};state=await writeCommand(db,'alice',command,now);
  const replay=await writeCommand(db,'alice',command,now);assert.equal(replay.revision,state.revision);
  const reloaded=await readWorkspace(db,'alice');assert.equal(reloaded.data.projects[0].status,'paused');assert.deepEqual(reloaded.data.projects[0].milestones,[milestone]);assert.equal(reloaded.data.projects[0].nextTaskId,'a');
  await assert.rejects(()=>writeCommand(db,'alice',{...command,operationId:randomUUID(),action:manage('completed','최종 결과')},now),RevisionConflict);
  assert.equal((await readWorkspace(db,'bob')).data.projects.length,0);
 }finally{db.close()}
});
