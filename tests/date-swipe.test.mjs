import test from 'node:test';import assert from 'node:assert/strict';
import {dateSwipeDirection} from '../lib/orbit/date-swipe.ts';
import {addDays} from '../lib/orbit/dates.ts';
import {taskCalendarEvent,categoryOf,categoryColor} from '../lib/orbit/calendar-categories.ts';
import {canEditCalendarEvent,moveRestriction,moveConflict} from '../lib/orbit/calendar-move.ts';
test('date swipe skips taps and vertical scroll and crosses month/year in the expected direction',()=>{
 assert.equal(dateSwipeDirection(-80,5),1);assert.equal(dateSwipeDirection(80,5),-1);assert.equal(dateSwipeDirection(40,0),0);assert.equal(dateSwipeDirection(80,100),0);
 assert.equal(addDays('2026-09-30',dateSwipeDirection(-80,0)),'2026-10-01');assert.equal(addDays('2027-01-01',dateSwipeDirection(80,0)),'2026-12-31');
});
test('due reminder opens its source task and cannot be independently moved or deleted',()=>{
 const event=taskCalendarEvent({id:'task',title:'채용',projectId:'hr',due:'2026-09-21',status:'todo',category:'health'});
 assert.equal(event.taskId,'task');assert.equal(event.allDay,true);assert.equal(event.date,'2026-09-21');assert.equal(canEditCalendarEvent(event),false);assert.equal(moveRestriction(event),'할 일에서 날짜 변경');
 assert.equal(categoryOf(event),'health');assert.equal(categoryColor('health',{categoryColors:{health:'#ffb878'}}),'#ffb878');
});

test('a due-date reminder does not block dragging a timed event',()=>{
 const event={id:'meeting',date:'2026-09-21',start:600,end:645,kind:'meeting'};
 const reminder=taskCalendarEvent({id:'task',title:'채용',projectId:'hr',due:event.date,status:'todo'});
 assert.equal(moveConflict(event,[reminder]),undefined);
 assert.equal(moveConflict(event,[{...event,id:'other'}]).id,'other');
});

test('unfinished dated tasks accumulate on today without changing their original due dates',async()=>{
 const {taskCalendarEvents,taskCalendarDate}=await import('../lib/orbit/calendar-categories.ts');
 const tasks=[{id:'old',due:'2026-08-01',status:'doing'},{id:'yesterday',due:'2026-09-20',status:'waiting'},{id:'today',due:'2026-09-21',status:'todo'},{id:'future',due:'2026-09-23',status:'todo'},{id:'done',due:'2026-09-18',status:'done',completedOn:'2026-09-20'}];
 const data={tasks,preferences:{timeZone:'Asia/Seoul'}};
 const rows=taskCalendarEvents(data,'2026-09-21');
 assert.deepEqual(rows.filter(e=>e.date==='2026-09-21').map(e=>e.taskId),['old','yesterday','today']);
 assert.equal(taskCalendarDate(tasks[3],'2026-09-21'),'2026-09-23');
 assert.equal(taskCalendarDate(tasks[4],'2026-09-22'),'2026-09-20');
 assert.equal(taskCalendarDate(tasks[0],'2026-09-22'),'2026-09-22');
 assert.equal(tasks[0].due,'2026-08-01');assert.equal(new Set(rows.map(e=>e.id)).size,tasks.length);
 assert.equal(taskCalendarDate({...tasks[4],status:'todo',completedOn:undefined},'2026-09-22'),'2026-09-22');
});

test('rollover follows the workspace timezone across the year boundary',async()=>{
 const {todayInZone}=await import('../lib/orbit/dates.ts');const {taskCalendarDate}=await import('../lib/orbit/calendar-categories.ts');
 const moment=new Date('2026-12-31T15:00:00Z'),task={due:'2026-12-31',status:'todo'};
 assert.equal(taskCalendarDate(task,todayInZone('Asia/Seoul',moment)),'2027-01-01');
 assert.equal(taskCalendarDate(task,todayInZone('America/Los_Angeles',moment)),'2026-12-31');
});
