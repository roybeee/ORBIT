import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarTimeline} from '../lib/orbit/calendar-timeline.ts';
import {normalizeEvents} from '../lib/orbit/agent/calendar.ts';
import {moveConflict} from '../lib/orbit/calendar-move.ts';
const today='2026-09-21';
const task={id:'t',title:'채용 제안',projectId:'p',due:today,status:'todo',duration:45,impact:3,focus:false,definition:'전달',category:'work'};
const event={id:'e',title:'미팅',date:today,start:600,end:645,kind:'meeting'};
test('completed untimed and timed tasks follow every unfinished task and calendar event',()=>{
 const tasks=[{...task,id:'done',status:'done',completedOn:today},{...task,id:'timed-done',status:'done',completedOn:today},task];
 const events=[{...event,id:'done-block',taskId:'timed-done',start:480,end:525},event];
 const rows=calendarTimeline(tasks,events,today,today);
 assert.deepEqual(rows.map(e=>e.id),['task-due:t','e','task-due:done','done-block']);
});
test('waiting tasks stay in the inbox instead of rolling over; fixed time blocks remain visible',()=>{
 const waiting={...task,status:'waiting',due:'2026-09-07'};
 const mirror={...event,id:'google:reminder',allDay:true,start:0,end:1440,google:{orbitEventId:'task-due:t'}};
 assert.deepEqual(calendarTimeline([waiting],[mirror,event],today,today).map(e=>e.id),['e']);
 assert.deepEqual(calendarTimeline([waiting],[],'2026-09-22','2026-09-22'),[]);
 assert.deepEqual(calendarTimeline([waiting],[{...event,taskId:'t'}],today,today).map(e=>e.id),['e']);
});
test('unified timeline carries unfinished tasks, retains completion dates and sorts actual times without mutating records',()=>{
 const tasks=[{...task,id:'old',due:'2026-09-19'},task,{...task,id:'future',due:'2026-09-23'},{...task,id:'done',status:'done',completedOn:'2026-09-20'}];
 const events=[{...event,id:'late',start:900,end:930},event,{...event,id:'holiday',allDay:true,start:0,end:1440}];const before=structuredClone({tasks,events});
 const rows=calendarTimeline(tasks,events,today,today);
 assert.deepEqual(rows.map(e=>e.id),['task-due:old','task-due:t','holiday','e','late']);
 assert.deepEqual({tasks,events},before);
 assert.deepEqual(calendarTimeline(tasks,events,'2026-09-20',today).map(e=>e.taskId),['done']);
 assert.deepEqual(calendarTimeline(tasks,events,'2026-09-23',today).map(e=>e.taskId),['future']);
 const untimed=rows.filter(e=>e.id.startsWith('task-due:'));assert.equal(moveConflict(event,untimed),undefined);
});
test('scheduled tasks appear in their actual blocks once, with no extra untimed reminder',()=>{
 const events=[{...event,taskId:'t'},{...event,id:'second',taskId:'t',start:800,end:830}];
 assert.deepEqual(calendarTimeline([task],events,today,today).map(e=>e.id),['e','second']);
});
test('Google all-day reminder mirrors merge with source tasks, while changed timed events are retained',()=>{
 const google={id:'g',summary:task.title,start:{date:today},end:{date:'2026-09-22'},extendedProperties:{private:{orbitEventId:'task-due:t'}}};
 const mirrors=normalizeEvents([google],'Asia/Seoul',today,'2026-09-22');assert.equal(mirrors[0].allDay,true);
 assert.deepEqual(calendarTimeline([task],mirrors,today,today).map(e=>e.id),['task-due:t']);
 assert.deepEqual(calendarTimeline([task],[...mirrors,{...event,taskId:'t'}],today,today).map(e=>e.id),['e']);
 const moved={...mirrors[0],allDay:false,start:720,end:750};const rows=calendarTimeline([task],[moved],today,today);
 assert.equal(rows.length,1);assert.equal(rows[0].id,moved.id);assert.equal(rows[0].taskId,'t');assert.equal(rows[0].start,720);
 const holiday=normalizeEvents([{...google,id:'holiday',extendedProperties:undefined}],'Asia/Seoul',today,'2026-09-22');
 assert.equal(calendarTimeline([task],holiday,today,today).length,2);
});
