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
