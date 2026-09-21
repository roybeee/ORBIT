import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {applyAction,DomainError} from '../lib/orbit/reducer.ts';
import {actionSchema} from '../lib/orbit/validation.ts';
import {taskScheduleSlots,taskScheduleProblem,scheduleBusyEvents} from '../lib/orbit/task-scheduling.ts';
import {calendarTimeline} from '../lib/orbit/calendar-timeline.ts';
const date='2026-09-21',now=new Date(date+'T00:02:00Z');
const project={id:'p',name:'재무',goal:'조달 계획',due:date,priority:3,color:'#5484ed',symbol:'F'};
const task={id:'t',title:'자금 계획',projectId:'p',due:'2026-09-07',duration:75,status:'todo',impact:3,focus:false,definition:'초안 완료',category:'work'};
const seed=()=>({...emptyWorkspace(),projects:[{...project}],tasks:[{...task}]});
const command=(extra={})=>actionSchema.parse({type:'task.schedule',taskId:'t',eventId:randomUUID(),date,start:570,minutes:45,...extra});
test('scheduling color is atomic, inherited when omitted, resettable and validated',()=>{
 const data=seed();data.tasks[0].color='#fbd75b';
 data.events=[{id:'earlier',taskId:'t',title:task.title,date:'2026-09-20',start:570,end:615,kind:'focus',color:'#fbd75b'}];
 assert.equal(applyAction(data,command(),now).events.at(-1).color,'#fbd75b');
 const changed=applyAction(data,command({color:'#f83a22'}),now);
 assert.equal(changed.tasks[0].color,'#f83a22');assert.ok(changed.events.every(e=>e.color==='#f83a22'));
 const reset=applyAction(data,command({color:null}),now);assert.equal(reset.tasks[0].color,null);assert.ok(reset.events.every(e=>e.color===null));
 assert.throws(()=>command({color:'#123456'}));
 assert.throws(()=>applyAction(data,command({color:'#f83a22',start:540}),now),DomainError);
 assert.equal(data.tasks[0].color,'#fbd75b');assert.equal(data.events.length,1);assert.equal(data.events[0].color,'#fbd75b');
});
test('quick scheduling replaces the untimed row with one linked timed block and preserves the original deadline and estimate',()=>{
 const before=seed(),action=command(),after=applyAction(before,action,now),event=after.events[0];
 assert.deepEqual({title:event.title,projectId:event.projectId,taskId:event.taskId,category:event.category,kind:event.kind,start:event.start,end:event.end},{title:task.title,projectId:'p',taskId:'t',category:'work',kind:'focus',start:570,end:615});
 assert.equal(after.tasks[0].due,'2026-09-07');assert.equal(after.tasks[0].duration,75);assert.equal(after.tasks[0].status,'todo');
 assert.deepEqual(calendarTimeline(after.tasks,after.events,date,date).map(e=>e.id),[action.eventId]);
 assert.equal(before.events.length,0);assert.deepEqual(before.tasks[0],task);
});
test('gap suggestions skip elapsed time, meetings, lunch, care and protected time without overlapping',()=>{
 const data=seed();data.preferences.travelMinutes=0;
 data.events=[{id:'e',title:'회의',date,start:600,end:660,kind:'meeting'}];
 data.careRoutines=[{id:'care',title:'운동',active:true,days:[1],start:780,minutes:30,log:[]}];
 data.weeklyAllocations=[{id:date,from:date,through:'2026-09-27',active:true,allocations:[],protectedBlocks:[{id:'hold',title:'가족',date,start:900,end:960}]}];
 const slots=taskScheduleSlots(data,date,75,now);assert.deepEqual(slots,[810,960]);
 assert.ok(slots.every(start=>!scheduleBusyEvents(data,date).some(e=>e.start<start+75&&e.end>start)));
 assert.deepEqual(taskScheduleSlots(data,'2026-09-20',75,now),[]);
 data.preferences.travelMinutes=15;assert.ok(scheduleBusyEvents(data,date).some(e=>e.id==='travel-before:e'&&e.start===585));
});
test('server rejects overlaps, past times, midnight overflow and repeated same-task scheduling',()=>{
 const data=seed();data.events=[{id:'e',title:'회의',date,start:600,end:660,kind:'meeting'}];
 for(const change of [{start:600},{start:540},{date:'2026-09-20'},{start:1430,minutes:45},{start:720}])assert.throws(()=>applyAction(data,command(change),now),DomainError);
 assert.equal(data.events.length,1);
 const scheduled=applyAction(seed(),command(),now);
 assert.throws(()=>applyAction(scheduled,command({start:900}),now),DomainError);
 const google=seed();google.events=[{id:'google:g',title:task.title,date,start:900,end:945,kind:'meeting',google:{calendarId:'primary',eventId:'g',orbitEventId:'task-due:t'}}];
 assert.match(taskScheduleProblem(google,command(),now),/이미 이날/);
});
test('waiting resolution is explicit and atomic, and cannot bypass unfinished dependencies or paused projects',()=>{
 const data=seed();data.tasks[0]={...task,status:'waiting',blocker:'회신 대기',checkDate:date};
 assert.throws(()=>applyAction(data,command(),now),DomainError);
 const resumed=applyAction(data,command({resolveWaiting:true}),now);assert.equal(resumed.tasks[0].status,'todo');assert.equal(resumed.tasks[0].blocker,undefined);assert.equal(resumed.tasks[0].checkDate,undefined);
 const dependent=structuredClone(data);dependent.tasks.push({...task,id:'first'});dependent.tasks[0].dependsOn=['first'];
 assert.throws(()=>applyAction(dependent,command({resolveWaiting:true}),now),DomainError);assert.equal(dependent.tasks[0].status,'waiting');assert.equal(dependent.tasks[0].blocker,'회신 대기');
 const paused=structuredClone(data);paused.projects[0].status='paused';assert.throws(()=>applyAction(paused,command({resolveWaiting:true}),now),DomainError);
 const done=seed();done.tasks[0].status='done';done.tasks[0].completedOn=date;assert.throws(()=>applyAction(done,command({resolveWaiting:true}),now),DomainError);
});
