import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {flushCalendarOutbox,calendarDeliveryStatus} from '../lib/orbit/agent/calendar-outbox.ts';
import {calendarExports} from '../lib/orbit/agent/calendar-export.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const event={id:'meeting',title:'Planning',date:'2026-10-08',start:600,end:660,kind:'meeting'};
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function connect(db){await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY)}
async function save(db,value=event,owner='a'){const snapshot=await readWorkspace(db,owner);const command={operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'event.upsert',event:value}};await writeCommand(db,owner,command);return command}
function google({lose=false}={}){let remote=null,posts=0,patches=0,account='owner@example.test',edited=false;
 globalThis.fetch=async(url,init={})=>{
  if(url.endsWith('/calendarList/primary'))return Response.json({id:account});
  if(init.method==='POST'){posts++;const value=JSON.parse(init.body);assert.equal(value.attendees,undefined);assert.ok(url.includes('sendUpdates=none'));remote={...value,etag:'"1"',htmlLink:'https://calendar.google.com/calendar/event?eid=test'};if(lose){lose=false;throw new Error('lost ack')}return Response.json(remote)}
  if(init.method==='DELETE'){assert.equal(init.headers['If-Match'],remote.etag);remote=null;return new Response(null,{status:204})}
  if(init.method==='PATCH'){patches++;assert.equal(init.headers['If-Match'],remote.etag);if(edited)return Response.json({}, {status:412});remote={...remote,...JSON.parse(init.body),etag:'"2"'};return Response.json(remote)}
  if(url.includes('/events/'))return remote?Response.json(remote):Response.json({}, {status:404});
  throw new Error('Unexpected request '+url);
 };
 return {get remote(){return remote},get posts(){return posts},get patches(){return patches},set account(value){account=value},changeTitle(){remote.summary='Changed in Google';remote.etag='"external"'},race(){edited=true}};
}
test('event save atomically queues delivery; replay and stale saves cannot duplicate or overwrite it',()=>fixture(async db=>{
 const command=await save(db);assert.equal((await calendarDeliveryStatus(db,'a')).pending,1);
 await writeCommand(db,'a',command);assert.equal((await calendarExports(db,'a')).length,1);
 await assert.rejects(()=>writeCommand(db,'a',{...command,operationId:randomUUID(),action:{type:'event.upsert',event:{...event,title:'stale'}}}));
 assert.equal((await readWorkspace(db,'a')).data.events[0].title,'Planning');assert.equal((await calendarDeliveryStatus(db,'b')).pending,0);
}));
test('new event is created once; lost Google acknowledgement is recovered without duplicate events',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google({lose:true});
 assert.equal((await flushCalendarOutbox(db,'a',env)).failed,1);
 assert.equal((await readWorkspace(db,'a')).data.events.length,1);
 assert.equal((await flushCalendarOutbox(db,'a',env)).verified,1);assert.equal(g.posts,1);
 await flushCalendarOutbox(db,'a',env);assert.equal(g.posts,1);
 assert.equal(g.remote.start.dateTime,'2026-10-08T01:00:00.000Z');
}));
test('disconnected save persists; reconnect retries only queued events and isolates owners',()=>fixture(async db=>{
 await save(db);assert.equal((await flushCalendarOutbox(db,'a',env)).failed,1);
 assert.equal((await readWorkspace(db,'a')).data.events[0].title,'Planning');
 await connect(db);const g=google();await flushCalendarOutbox(db,'b',env);assert.equal(g.posts,0);
 await flushCalendarOutbox(db,'a',env);assert.equal(g.posts,1);
}));
test('editing a linked event updates the same Google event with an ETag precondition',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google();await flushCalendarOutbox(db,'a',env);
 await save(db,{...event,title:'Updated',start:630,end:690});
 const result=await flushCalendarOutbox(db,'a',env);assert.equal(result.verified,1);assert.equal(g.posts,1);assert.equal(g.patches,1);assert.equal(g.remote.summary,'Updated');
}));
test('an edit after a lost create acknowledgement recovers the created event before patching',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google({lose:true});await flushCalendarOutbox(db,'a',env);
 await save(db,{...event,title:'Updated after timeout'});await flushCalendarOutbox(db,'a',env);
 assert.equal(g.posts,1);assert.equal(g.patches,1);assert.equal(g.remote.summary,'Updated after timeout');
}));
test('Google-side edits are preserved and a changed connected account cannot receive the old event',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google();await flushCalendarOutbox(db,'a',env);
 g.changeTitle();await save(db,{...event,title:'Orbit edit'});assert.equal((await flushCalendarOutbox(db,'a',env)).failed,1);assert.equal(g.patches,0);assert.equal(g.remote.summary,'Changed in Google');
 g.account='another@example.test';assert.equal((await flushCalendarOutbox(db,'a',env)).failed,1);assert.equal(g.posts,1);assert.match((await calendarExports(db,'a'))[0].message,/계정/);
}));
test('removed pending event is not published; simultaneous flushers share the receipt lease',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google();await Promise.all([flushCalendarOutbox(db,'a',env),flushCalendarOutbox(db,'a',env)]);assert.equal(g.posts,1);
 await save(db,{...event,id:'removed',start:700,end:760});const snapshot=await readWorkspace(db,'a');await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'event.delete',id:'removed'}});
 await flushCalendarOutbox(db,'a',env);assert.equal(g.posts,1);assert.equal((await calendarExports(db,'a')).find(x=>x.eventId==='removed').status,'cancelled');
}));
test('explicit status check revalidates verified receipts against Google',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google();await flushCalendarOutbox(db,'a',env);g.changeTitle();
 const checked=await flushCalendarOutbox(db,'a',env,event.id);assert.equal(checked.failed,1);assert.equal(checked.verified,0);assert.equal(g.patches,0);
}));
test('read failures after several edits preserve the signature of a lost write',()=>fixture(async db=>{
 await connect(db);await save(db);const g=google({lose:true});await flushCalendarOutbox(db,'a',env);const connectedFetch=globalThis.fetch;
 for(const title of ['B','C','D','E']){await save(db,{...event,title});globalThis.fetch=async(url,init)=>url.includes('/events/')?Response.json({}, {status:503}):connectedFetch(url,init);await flushCalendarOutbox(db,'a',env);}
 globalThis.fetch=connectedFetch;assert.equal((await flushCalendarOutbox(db,'a',env)).verified,1);assert.equal(g.posts,1);assert.equal(g.remote.summary,'E');
}));
test('a delivery completed immediately before the workspace transaction retains its metadata',()=>fixture(async db=>{
 await save(db);const wrapped={prepare:sql=>db.prepare(sql),batch:async statements=>{
  await db.prepare("UPDATE orbit_calendar_exports SET state_json=json_set(state_json,'$.calendarId','bound@example.test','$.lastSignature','verified-signature','$.status','verified') WHERE owner_id=?").bind('a').run();return db.batch(statements);
 }};
 await save(wrapped,{...event,title:'New local edit'});const receipt=(await calendarExports(db,'a'))[0];assert.equal(receipt.status,'pending');assert.equal(receipt.calendarId,'bound@example.test');assert.equal(receipt.lastSignature,'verified-signature');
}));

async function taskFixture(db){
 let snapshot=await readWorkspace(db,'a');
 snapshot=await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'project.upsert',project:{id:'hr',name:'채용',goal:'채용 제안',due:'2026-09-30',priority:3,color:'#5484ed',symbol:'H'}}});
 const task={id:'recruit',title:'마케터1명 채용 제안',projectId:'hr',status:'todo',due:'2026-09-21',duration:45,impact:3,focus:false,definition:'제안 전달',category:'work'};
 await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.upsert',task}});return task;
}
test('dated project task creates one transparent all-day Google event and changing its date patches the same ID',()=>fixture(async db=>{
 const task=await taskFixture(db);assert.equal((await calendarExports(db,'a'))[0].eventId,'task-due:recruit');
 await connect(db);const g=google({lose:true});await flushCalendarOutbox(db,'a',env,'task-due:recruit');await flushCalendarOutbox(db,'a',env,'task-due:recruit');
 assert.equal(g.posts,1);assert.deepEqual(g.remote.start,{date:'2026-09-21'});assert.deepEqual(g.remote.end,{date:'2026-09-22'});assert.equal(g.remote.transparency,'transparent');assert.equal(g.remote.colorId,'9');const id=g.remote.id;
 const snapshot=await readWorkspace(db,'a');assert.equal(snapshot.data.events.length,0,'due reminders must not reserve the entire day in the planner');
 await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.upsert',task:{...task,due:'2026-09-22',category:'health'}}});
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');assert.equal(g.posts,1);assert.equal(g.patches,1);assert.equal(g.remote.id,id);assert.equal(g.remote.start.date,'2026-09-22');assert.equal(g.remote.end.date,'2026-09-23');assert.equal(g.remote.colorId,'2');
}));
test('existing dated task backfill is idempotent and completion updates the same reminder',()=>fixture(async db=>{
 const {queueTaskCalendarBackfill}=await import('../db/repository.ts');
 await taskFixture(db);await db.prepare('DELETE FROM orbit_calendar_exports WHERE owner_id=?').bind('a').run();
 await queueTaskCalendarBackfill(db,'b','2026-09-21');assert.equal((await calendarExports(db,'b')).length,0);
 await queueTaskCalendarBackfill(db,'a','2026-09-21');await queueTaskCalendarBackfill(db,'a','2026-09-21');assert.equal((await calendarExports(db,'a')).length,1);
 await connect(db);const g=google();await flushCalendarOutbox(db,'a',env,'task-due:recruit');
 await queueTaskCalendarBackfill(db,'a','2026-09-21');assert.equal((await calendarExports(db,'a'))[0].status,'verified');
 const snapshot=await readWorkspace(db,'a');await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'recruit',status:'done'}});
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');assert.equal(g.remote.summary,'✓ 마케터1명 채용 제안');assert.equal(g.posts,1);
}));
test('category palette changes update queued task colors and local event colors',()=>fixture(async db=>{
 await taskFixture(db);await connect(db);const g=google();await flushCalendarOutbox(db,'a',env,'task-due:recruit');
 const snapshot=await readWorkspace(db,'a');await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'preferences.update',preferences:{...snapshot.data.preferences,categoryColors:{work:'#ffb878'}}}});
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');assert.equal(g.remote.colorId,'6');assert.equal(g.posts,1);assert.equal(g.patches,1);
}));

test('deleting a task removes only its unchanged owned Google reminder',()=>fixture(async db=>{
 await taskFixture(db);await connect(db);const g=google();await flushCalendarOutbox(db,'a',env,'task-due:recruit');
 const snapshot=await readWorkspace(db,'a');await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.delete',id:'recruit'}});
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');assert.equal(g.remote,null);assert.equal((await calendarExports(db,'a'))[0].status,'cancelled');
}));

test('midnight rollover moves the same Google task, includes old backlog, and stops after completion',t=>fixture(async db=>{
 const {queueTaskCalendarBackfill}=await import('../db/repository.ts');
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-21T03:00:00Z')});
 await taskFixture(db);await connect(db);const g=google();
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');const id=g.remote.id;
 assert.equal(g.remote.start.date,'2026-09-21');
 // Several days offline still produce just one carried item on return.
 t.mock.timers.setTime(new Date('2026-10-03T03:00:00Z').getTime());await connect(db);
 await queueTaskCalendarBackfill(db,'a','2026-10-03');
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');
 assert.equal(g.remote.start.date,'2026-10-03');assert.equal(g.remote.id,id);assert.equal(g.posts,1);assert.equal(g.patches,1);
 await queueTaskCalendarBackfill(db,'a','2026-10-03');assert.equal((await calendarExports(db,'a'))[0].status,'verified');
 const snapshot=await readWorkspace(db,'a');assert.equal(snapshot.data.tasks[0].due,'2026-09-21');
 await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'task.status',id:'recruit',status:'done'}});
 await flushCalendarOutbox(db,'a',env,'task-due:recruit');assert.equal(g.remote.start.date,'2026-10-03');
 t.mock.timers.setTime(new Date('2026-10-04T03:00:00Z').getTime());
 await queueTaskCalendarBackfill(db,'a','2026-10-04');assert.equal((await calendarExports(db,'a'))[0].status,'verified');
 assert.equal(g.posts,1);assert.equal(g.remote.start.date,'2026-10-03');
}));
