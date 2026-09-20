import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {taskCalendarEvents} from '../lib/orbit/calendar-categories.ts';
import {workEligibility} from '../lib/orbit/work-policy.ts';
const today='2026-09-21',now=new Date(today+'T01:00:00Z');
function seed(){return {...emptyWorkspace(),projects:[{id:'p',name:'재무',goal:'계획',due:today,priority:3,color:'#5484ed',symbol:'F'}],tasks:[{id:'t',title:'자금 계획',projectId:'p',due:'2026-09-07',status:'doing',duration:75,impact:3,focus:true,focusDate:today,laserDate:today,definition:'초안',startedAt:today+'T00:50:00Z'}]}}
test('holding moves the task to waiting, stops its timer and keeps the deadline and past work',()=>{
 const data=seed();const held=applyAction(data,actionSchema.parse({type:'task.hold',id:'t'}),now),task=held.tasks[0];
 assert.equal(task.status,'waiting');assert.equal(task.due,'2026-09-07');assert.equal(task.actualMinutes,10);
 assert.equal(task.startedAt,undefined);assert.equal(task.focus,false);assert.equal(task.focusDate,undefined);assert.equal(task.laserDate,undefined);
 assert.equal(workEligibility(held,task,today).allowed,false);assert.deepEqual(taskCalendarEvents(held,today),[]);
 assert.deepEqual(taskCalendarEvents(held,'2026-09-22'),[]);assert.equal(data.tasks[0].status,'doing');
 const replayed=applyAction(held,{type:'task.hold',id:'t'},now);assert.equal(replayed.tasks[0].actualMinutes,10);
 const resumed=applyAction(held,{type:'task.status',id:'t',status:'todo'},now);
 assert.equal(resumed.tasks[0].due,'2026-09-07');assert.equal(taskCalendarEvents(resumed,today)[0].date,today);
 assert.equal(workEligibility(resumed,resumed.tasks[0],today).allowed,true);
});
test('holding preserves existing appointments and cannot turn completed work into waiting work',()=>{
 const data=seed();data.events=[{id:'e',taskId:'t',title:'배정',date:today,start:660,end:720,kind:'focus'}];
 const held=applyAction(data,{type:'task.hold',id:'t'},now);assert.deepEqual(held.events,data.events);
 const done=applyAction(data,{type:'task.status',id:'t',status:'done'},now);
 assert.throws(()=>applyAction(done,{type:'task.hold',id:'t'},now),DomainError);
});
