import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftedEvent,moveConflict,moveRestriction,eventCommand} from '../lib/orbit/calendar-move.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {actionSchema} from '../lib/orbit/validation.ts';

const event={id:'local-1',title:'산책',date:'2026-09-19',start:600,end:645,kind:'meeting'};
test('vertical gestures move in 15 minute increments and preserve duration',()=>{
  assert.equal(shiftedEvent(event,8).start,600);
  assert.deepEqual(shiftedEvent(event,48),{...event,start:630,end:675});
  assert.deepEqual(shiftedEvent(event,-48),{...event,start:570,end:615});
});
test('day boundaries retain duration and stay in the same day',()=>{
  assert.deepEqual(shiftedEvent(event,-10000),{...event,start:0,end:45});
  assert.deepEqual(shiftedEvent(event,10000),{...event,start:1395,end:1440});
});
test('overlap excludes own Google mirror and allows adjacent events',()=>{
  const after=shiftedEvent(event,48);
  const mirror={...event,id:'google:mirror',google:{calendarId:'primary',eventId:'mirror',orbitEventId:event.id}};
  assert.equal(moveConflict(after,[event,mirror,{...event,id:'adjacent',start:675,end:700}]),undefined);
  assert.equal(moveConflict(after,[{...event,id:'other',start:660,end:700}])?.id,'other');
});
test('imported, approved and protected records have explicit edit restrictions',()=>{
  assert.equal(moveRestriction(event),null);
  for(const prefix of ['google:','approved:','protected:']) assert.ok(moveRestriction({...event,id:prefix+'1'}));
  assert.ok(moveRestriction({...event,start:0,end:1440}));
});
test('move and undo use the workspace reducer without adding a duplicate event',()=>{
  let data=emptyWorkspace();
  data.events=[event];
  const after=shiftedEvent(event,48);
  const command=eventCommand(after);
  assert.equal(actionSchema.safeParse(command).success,true);
  data=applyAction(data,command,new Date('2026-09-19T08:00:00Z'));
  assert.equal(data.events.length,1);
  assert.equal(data.events[0].start,630);
  data=applyAction(data,eventCommand(event),new Date('2026-09-19T08:00:00Z'));
  assert.equal(data.events[0].start,600);
});
test('server also rejects a conflicting move and leaves source data unchanged',()=>{
  const data=emptyWorkspace();data.events=[event,{...event,id:'other',start:660,end:700}];
  assert.throws(()=>applyAction(data,eventCommand(shiftedEvent(event,48))));
  assert.equal(data.events[0].start,600);
});
