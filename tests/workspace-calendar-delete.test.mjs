import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleCalendarDelivery} from '../app/api/workspace/calendar-delivery.ts';

// Execute the exact after-response dispatcher used by POST /api/workspace.
// Delivery is a spy; database/outbox/Google behavior is covered by calendar-reconcile.
function delivery() {
 const scheduled = [], calls = [];
 return {scheduled,calls,dependencies:{
  after(work){scheduled.push(work)},
  async flush(eventId,force){calls.push({eventId,force})},
  async hasWork(){return true},
 }};
}

test('deleting the sole event schedules delivery even when there are no tasks', async()=>{
 const d=delivery();
 scheduleCalendarDelivery({type:'event.delete',id:'deleted-event'},0,d.dependencies);
 assert.equal(d.scheduled.length,1,'event deletion must schedule an immediate after-response flush');
 assert.deepEqual(d.calls,[],'delivery must wait for the response lifecycle');
 await d.scheduled[0]();
 assert.deepEqual(d.calls,[{eventId:'deleted-event',force:undefined}]);
});

test('deletion prioritizes its event id over unrelated pending task deliveries',async()=>{
 const d=delivery();
 scheduleCalendarDelivery({type:'event.delete',id:'deleted-event'},3,d.dependencies);
 await d.scheduled[0]();
 assert.deepEqual(d.calls,[{eventId:'deleted-event',force:undefined}]);
});

test('an unrelated command in an event-only workspace does not schedule delivery',()=>{
 const d=delivery();
 scheduleCalendarDelivery({type:'project.delete',id:'unused-project'},0,d.dependencies);
 assert.equal(d.scheduled.length,0);
});

test('preferences keep the bounded forced delivery drain',async()=>{
 const d=delivery();
 scheduleCalendarDelivery({type:'preferences.update',preferences:{}},0,d.dependencies);
 await d.scheduled[0]();
 assert.equal(d.calls.length,6);
 assert.ok(d.calls.every(call=>call.eventId===undefined&&call.force===true));
});
