import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {registrationOverlap,overlapReview} from '../lib/orbit/overlap-review.ts';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {createDatabase} from './sqlite-d1.mjs';
import {generateProposal} from '../lib/orbit/planner.ts';
const date='2026-10-08',now=new Date('2026-10-07T00:00:00Z');
const busy={id:'meeting',title:'기존 회의',date,start:600,end:660,kind:'meeting'};
const event={...busy,id:'new',title:'통화',start:630,end:675};
const seed=()=>({...emptyWorkspace(),events:[{...busy}]});
const action=()=>({type:'event.upsert',event:{...event}});
const approve=(data,command)=>actionSchema.parse({...command,overlapConfirmation:registrationOverlap(data,command).confirmation});
test('manual overlap requires exact explicit approval and preserves both events',()=>{
 const data=seed(),command=action(),review=registrationOverlap(data,command);
 assert.match(review.message,/기존 회의/);assert.match(review.message,/10:00–11:00/);
 assert.throws(()=>applyAction(data,command,now),DomainError);
 assert.throws(()=>applyAction(data,{...command,overlapConfirmation:'true'},now),DomainError);
 const next=applyAction(data,approve(data,command),now);
 assert.equal(next.events.length,2);assert.deepEqual(next.events.find(e=>e.id==='meeting'),busy);
 assert.equal(next.events.find(e=>e.id==='new').start,630);
 // Memo-only edits do not rebook an already approved overlap.
 assert.equal(registrationOverlap(next,{...command,event:{...event,description:'후속 메모'}}),null);
 assert.equal(applyAction(next,{...command,event:{...event,description:'후속 메모'}},now).events[1].description,'후속 메모');
});
test('changed time, target or conflict invalidates prior overlap consent',()=>{
 const data=seed(),command=approve(data,action());
 for(const change of [{start:640},{id:'another'},{title:'다른 통화'}])assert.throws(()=>applyAction(data,{...command,event:{...event,...change}},now),DomainError);
 for(const change of [{start:620},{title:'수정된 회의'},{end:650}]){const changed=seed();Object.assign(changed.events[0],change);assert.throws(()=>applyAction(changed,command,now),DomainError)}
 const changed=seed();changed.events.push({...busy,id:'another',title:'새 회의'});assert.throws(()=>applyAction(changed,command,now),DomainError);
 assert.equal(applyAction(changed,approve(changed,action()),now).events.length,3);
});
test('boundaries, untimed task reminders and the edited Google mirror do not create false conflicts',()=>{
 const command=action(),data=seed();data.events[0].end=630;assert.equal(registrationOverlap(data,command),null);
 data.events=[{...busy,id:'task-due:t',start:0,end:1440,allDay:true},{...busy,id:'google:mirror',google:{calendarId:'primary',eventId:'remote',orbitEventId:'new'}}];
 assert.equal(registrationOverlap(data,command),null);
 const review=overlapReview({id:'edit',title:'출장',startDate:date,endDate:'2026-10-10',start:0,end:0,allDay:true},[{...busy,date:'2026-10-09'}]);assert.equal(review.conflicts.length,1);
});
test('task scheduling accepts reviewed overlaps but cannot bypass waiting, dependencies or invalid times',()=>{
 const data=seed();data.projects=[{id:'p',name:'업무',goal:'완료',due:date,priority:3,color:'#5484ed',symbol:'P'}];
 data.tasks=[{id:'t',title:'통화',projectId:'p',due:date,duration:30,status:'todo',focus:false,impact:3,definition:'통화 완료',description:'견적 문의',scope:'other',category:'phone',color:'#ffb878'}];
 const command={type:'task.schedule',taskId:'t',eventId:randomUUID(),date,start:630,minutes:30};
 assert.throws(()=>applyAction(data,command,now),DomainError);
 const confirmed=approve(data,command),next=applyAction(data,confirmed,now),block=next.events.find(e=>e.taskId==='t');
 assert.equal(block.description,'견적 문의');assert.equal(block.scope,'other');assert.equal(block.category,'phone');assert.equal(block.color,'#ffb878');
 const waiting=structuredClone(data);waiting.tasks[0].status='waiting';assert.throws(()=>applyAction(waiting,confirmed,now),DomainError);
 assert.throws(()=>applyAction(data,{...confirmed,start:1430,minutes:60},now),DomainError);
 assert.throws(()=>applyAction(next,{...confirmed,eventId:randomUUID()},now),DomainError);
});
test('confirmed overlap commits and queues once; replay is idempotent and stale revisions cannot authorize new conflicts',async()=>{
 const db=createDatabase();try{
  await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'event.upsert',event:busy}});
  let snapshot=await readWorkspace(db,'owner');const command={operationId:randomUUID(),expectedRevision:snapshot.revision,action:approve(snapshot.data,action())};
  await writeCommand(db,'owner',command);await writeCommand(db,'owner',command);
  snapshot=await readWorkspace(db,'owner');assert.equal(snapshot.data.events.length,2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orbit_calendar_exports WHERE owner_id=?').bind('owner').first()).n,2);
  await assert.rejects(()=>writeCommand(db,'owner',{...command,operationId:randomUUID()}));
 }finally{db.close()}
});
test('focus proposal approval can explicitly retain a conflicting block without bypassing task validation',()=>{
 const data=seed();data.projects=[{id:'p',name:'업무',goal:'완료',due:date,priority:3,color:'#5484ed',symbol:'P'}];
 data.tasks=[{id:'t',title:'검토',projectId:'p',due:date,duration:60,status:'todo',focus:false,impact:3,definition:'검토 완료',description:'필수 자료',scope:'work',category:'phone',color:'#fbd75b'}];
 const proposal=generateProposal(data.tasks,[],date),item=proposal.items[0];assert.ok(item);
 data.proposals=[proposal];data.events=[{...busy,start:item.start,end:item.end}];
 const command={type:'proposal.approve',date,itemId:item.id};assert.throws(()=>applyAction(data,command,now),DomainError);
 const approved=approve(data,command),next=applyAction(data,approved,now),block=next.events.find(e=>e.id==='approved:'+item.id);
 assert.equal(block.start,item.start);assert.equal(block.description,'필수 자료');assert.equal(block.scope,'work');assert.equal(block.color,'#fbd75b');
 assert.equal(applyAction(next,approved,now).events.length,2);
 data.tasks[0].duration=90;assert.throws(()=>applyAction(data,approved,now),DomainError);
});
