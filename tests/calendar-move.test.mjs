import test from 'node:test';
import assert from 'node:assert/strict';
import {shiftedEvent,postponedEvent,postponedCalendarEdit,moveConflict,moveRestriction,eventCommand,canEditCalendarEvent,calendarGestureIntent,swipeOffset,SWIPE_ACTION_WIDTH,SWIPE_OPEN_THRESHOLD} from '../lib/orbit/calendar-move.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';
import {actionSchema} from '../lib/orbit/validation.ts';

const event={id:'local-1',title:'산책',date:'2026-09-19',start:600,end:645,kind:'meeting'};
test('early horizontal movement chooses swipe; scrolling and diagonal gestures remain scrolling',()=>{
  assert.equal(calendarGestureIntent(-7,2),'pending');
  assert.equal(calendarGestureIntent(-20,3),'swipe');
  assert.equal(calendarGestureIntent(20,3),'swipe');
  assert.equal(calendarGestureIntent(-3,20),'scroll');
  assert.equal(calendarGestureIntent(-12,12),'scroll');
});
test('swipe reveals actions without changing event times and can close from the open position',()=>{
  const original={...event};
  assert.equal(swipeOffset(0,-1000),-SWIPE_ACTION_WIDTH);
  assert.ok(swipeOffset(0,-60)<=-SWIPE_OPEN_THRESHOLD);
  assert.ok(swipeOffset(0,-20)>-SWIPE_OPEN_THRESHOLD);
  assert.equal(swipeOffset(-SWIPE_ACTION_WIDTH,200),0);
  assert.equal(swipeOffset(0,100),0);
  assert.deepEqual(event,original);
});
test('local all-day events allow edit/delete even though vertical time movement is restricted',()=>{
  const allDay={...event,start:0,end:1440};
  assert.equal(canEditCalendarEvent(allDay),true);
  assert.ok(moveRestriction(allDay));
  for(const prefix of ['google:','approved:','protected:']) assert.equal(canEditCalendarEvent({...event,id:prefix+'1'}),false);
});
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

test('moving an event preserves the memo and schedule classification through strict command parsing',()=>{
 const original={...event,description:'통화 자료 확인\n다음 주 회신',scope:'work'};const command=actionSchema.parse(eventCommand(shiftedEvent(original,48)));assert.equal(command.event.description,original.description);assert.equal(command.event.scope,'work');
 assert.equal(actionSchema.safeParse({...command,event:{...command.event,scope:'invalid'}}).success,false);
});

test('postponing a local event changes only its start range and preserves duration and relations',()=>{
 const original={...event,projectId:'project',taskId:'task',description:'메모',scope:'work',category:'meeting',color:'#5484ed',projectAutoLink:false,projectLink:{method:'keyword',matched:['산책']}};
 const moved=postponedEvent(original,'2026-09-23',780,{date:'2026-09-21',minute:700});
 assert.deepEqual(moved,{...original,date:'2026-09-23',start:780,end:825});
 assert.equal(actionSchema.safeParse(eventCommand(moved)).success,true);
});

test('postponing rejects a past start and a same-day range that cannot preserve duration',()=>{
 assert.throws(()=>postponedEvent(event,'2026-09-21',699,{date:'2026-09-21',minute:700}),/과거/);
 assert.throws(()=>postponedEvent(event,'2026-09-22',1420,{date:'2026-09-21',minute:700}),/종료/);
});

test('postponing a Google edit preserves the full duration across dates and unrelated edit fields',()=>{
 const edit={operationId:'00000000-0000-4000-8000-000000000000',id:'google:one',calendarId:'primary',eventId:'one',etag:'"v1"',timeZone:'Asia/Seoul',title:'출장',startDate:'2026-09-21',endDate:'2026-09-22',start:1380,end:60,allDay:false,description:'준비',scope:'work'};
 assert.deepEqual(postponedCalendarEdit(edit,'2026-09-25',600,{date:'2026-09-21',minute:700}),{...edit,startDate:'2026-09-25',endDate:'2026-09-25',start:600,end:720});
});
