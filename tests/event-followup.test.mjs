import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,upsertProjectRelation} from '../db/repository.ts';
import {projectOpenItems} from '../lib/orbit/derived.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const vite=await createServer({appType:'custom',configFile:false,root,resolve:{alias:{'@':root}},server:{middlewareMode:true}});
after(async()=>vite.close());

const project={id:'old-ferry',name:'올드페리도넛',color:'#5558e8',symbol:'O',goal:'매장 오픈',due:'2026-10-01',priority:5,status:'completed',result:'1차 준비 완료',completedOn:'2026-09-20',statusHistory:[{status:'completed',changedOn:'2026-09-20'}]};
const event={id:'meeting-song',title:'송석민 대표 인테리어 미팅',date:'2026-09-22',start:600,end:660,kind:'meeting',projectId:project.id};
const task={id:'manual-task',title:'견적 확인',projectId:project.id,status:'todo',duration:30,due:'2026-09-21',impact:4,focus:false,definition:'견적 승인 여부 확인'};
const command=(revision,action,operationId=randomUUID())=>({expectedRevision:revision,action,operationId});
const beforeEnd=new Date('2026-09-22T01:30:00Z'); // 10:30 Asia/Seoul
const afterEnd=new Date('2026-09-22T02:30:00Z'); // 11:30 Asia/Seoul

async function seeded(db,owner='alice'){
 let state=await writeCommand(db,owner,command(0,{type:'project.upsert',project}),beforeEnd);
 state=await writeCommand(db,owner,command(state.revision,{type:'task.upsert',task}),beforeEnd);
 state=await writeCommand(db,owner,command(state.revision,{type:'project.status',id:project.id,status:'completed'}),beforeEnd);
 return state;
}

test('project open items project canonical tasks and events without merging entity types',async()=>{
 const db=createDatabase();try{
  let state=await seeded(db);
  state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);
  const items=projectOpenItems(state.data,project.id);
  assert.deepEqual(items.map(item=>item.entityType).sort(),['event','task']);
  assert.equal(items.find(item=>item.entityType==='event').status,'open');
  assert.equal(items.find(item=>item.entityType==='task').status,'todo');
  assert.equal(state.data.projects[0].status,'active','a future event reopens the completed project');
  assert.equal(state.data.projects[0].result,project.result);
  assert.equal(state.data.projects[0].completedOn,project.completedOn);
 }finally{db.close()}
});

test('due dates never auto-complete ordinary tasks while an overdue event creates one owner-scoped review',async()=>{
 const db=createDatabase();try{
  const state=await seeded(db);
  await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);
  assert.equal((await readWorkspace(db,'alice',beforeEnd)).data.eventReviews.length,0);
  const first=await readWorkspace(db,'alice',afterEnd);
  const second=await readWorkspace(db,'alice',afterEnd);
  assert.equal(first.data.tasks.find(item=>item.id===task.id).status,'todo');
  assert.equal(first.data.eventReviews.length,1);
  assert.equal(first.data.eventReviews[0].state,'pending');
  assert.equal(second.data.eventReviews.length,1,'foreground replay remains exactly once');
  assert.equal((await readWorkspace(db,'bob',afterEnd)).data.eventReviews.length,0);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM orbit_event_reviews WHERE owner_id='alice'").first()).n,1);
 }finally{db.close()}
});

test('review approval supports complete, complete with next action, and explicit defer',async t=>{
 await t.test('complete only records the event review and does not auto-complete the project',async()=>{
  const db=createDatabase();try{
   let state=await seeded(db);
   state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);
   state=await readWorkspace(db,'alice',afterEnd);
   const review=state.data.eventReviews[0];
   assert.equal(state.data.tasks.length,1,'pending review has no task side effect');
   const approve=command(state.revision,{type:'event.review',reviewId:review.id,decision:'complete'});
   state=await writeCommand(db,'alice',approve,afterEnd);
   state=await writeCommand(db,'alice',approve,afterEnd);
   assert.equal(state.data.eventReviews[0].state,'completed');
   assert.equal(state.data.tasks.length,1);
   assert.equal(state.data.projects[0].status,'active');
   await assert.rejects(()=>writeCommand(db,'alice',command(state.revision,{type:'event.review',reviewId:review.id,decision:'complete'}),afterEnd),/이미 처리/);
   state=await writeCommand(db,'alice',command(state.revision,{type:'event.delete',id:event.id}),afterEnd);
   assert.equal(state.data.eventReviews[0].state,'completed','deleting an approved event preserves its review record');
  }finally{db.close()}
 });
 await t.test('next action is persisted atomically as an incomplete task in the same project',async()=>{
  const db=createDatabase();try{let state=await seeded(db);state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);state=await readWorkspace(db,'alice',afterEnd);const review=state.data.eventReviews[0];state=await writeCommand(db,'alice',command(state.revision,{type:'event.review',reviewId:review.id,decision:'next',title:'인테리어 견적 승인',due:'2026-09-24'}),afterEnd);const next=state.data.tasks.find(item=>item.title==='인테리어 견적 승인');assert.ok(next);assert.equal(next.projectId,project.id);assert.equal(next.status,'todo');assert.equal(state.data.eventReviews[0].state,'completed');assert.equal(state.data.eventReviews[0].nextTaskId,next.id)}finally{db.close()}
 });
 await t.test('defer keeps the event open until the explicit follow-up instant',async()=>{
  const db=createDatabase();try{let state=await seeded(db);state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);state=await readWorkspace(db,'alice',afterEnd);const review=state.data.eventReviews[0];state=await writeCommand(db,'alice',command(state.revision,{type:'event.review',reviewId:review.id,decision:'defer',followUpAt:'2026-09-23T03:00:00.000Z'}),afterEnd);assert.equal(state.data.eventReviews[0].state,'deferred');assert.equal((await readWorkspace(db,'alice',new Date('2026-09-23T02:59:00Z'))).data.eventReviews[0].state,'deferred');assert.equal((await readWorkspace(db,'alice',new Date('2026-09-23T03:01:00Z'))).data.eventReviews[0].state,'pending')}finally{db.close()}
 });
});

test('cancel, move and canonical sync are replay-safe and preserve project relation',async()=>{
 const db=createDatabase();try{
  let state=await seeded(db);
  state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event}),beforeEnd);
  state=await readWorkspace(db,'alice',afterEnd);
  state=await writeCommand(db,'alice',command(state.revision,{type:'event.upsert',event:{...event,date:'2026-09-24'}}),afterEnd);
  state=await readWorkspace(db,'alice',afterEnd);
  assert.equal(state.data.eventReviews.length,1);
  assert.equal(state.data.eventReviews[0].state,'deferred','moving overdue event into future removes it from pending without replacing its review');
  state=await writeCommand(db,'alice',command(state.revision,{type:'event.delete',id:event.id}),afterEnd);
  state=await readWorkspace(db,'alice',afterEnd);
  assert.equal(state.data.eventReviews[0].state,'cancelled');

  const external={...event,id:'google:native-instance:2026-09-22',projectId:undefined};
  const activeHistoryBefore=state.data.projects[0].statusHistory.filter(item=>item.status==='active').length;
  await db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) VALUES(?,?,?,?,?,?)').bind('alice',JSON.stringify([external]),'Asia/Seoul','2026-09-15','2026-10-15',afterEnd.toISOString()).run();
  await upsertProjectRelation(db,'alice',{entityType:'event',entityId:external.id,projectId:project.id,sourceProvider:'google_calendar',sourceId:'native-instance',sourceDate:external.date,resolution:'explicit',evidence:['fixture']},beforeEnd);
  await upsertProjectRelation(db,'alice',{entityType:'event',entityId:external.id,projectId:project.id,sourceProvider:'google_calendar',sourceId:'native-instance',sourceDate:external.date,resolution:'explicit',evidence:['fixture']},beforeEnd);
  state=await readWorkspace(db,'alice',beforeEnd);
  assert.equal(state.data.events.find(item=>item.id===external.id).projectId,project.id);
  assert.equal(state.data.projects[0].status,'active');
  assert.equal(state.data.projects[0].statusHistory.filter(item=>item.status==='active').length,activeHistoryBefore,'relation replay cannot duplicate reopen history');
 }finally{db.close()}
});

test('review card asks both approval questions and exposes all three outcomes',async()=>{
 const {EventReviewCard}=await vite.ssrLoadModule('/components/orbit/event-review-card.tsx');
 const review={id:'review',eventId:event.id,projectId:project.id,title:event.title,date:event.date,start:event.start,end:event.end,state:'pending',requestedAt:afterEnd.toISOString()};
 const html=renderToStaticMarkup(React.createElement(EventReviewCard,{review,busy:false,onResolve:()=>{}}));
 for(const text of ['일이 끝났나요?','다음 액션이 있나요?','완료만 표시','완료 + 다음 액션','아직 진행 중 / 다시 확인','다음 액션 제목','다시 확인할 시각'])assert.match(html,new RegExp(text.replace('+','\\+')));
});
