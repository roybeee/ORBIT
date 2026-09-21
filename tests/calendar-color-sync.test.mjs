import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand,queueGoogleColorBackfill} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {normalizeEvents} from '../lib/orbit/agent/calendar.ts';
import {flushCalendarOutbox,calendarDeliveryStatus} from '../lib/orbit/agent/calendar-outbox.ts';
import {googleColorKey} from '../lib/orbit/calendar-color-sync.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const source={id:'instance_20260921',summary:'제주도 관련 통화',etag:'"1"',recurringEventId:'series',start:{dateTime:'2026-09-21T10:00:00+09:00'},end:{dateTime:'2026-09-21T10:30:00+09:00'},attendees:[{email:'guest@example.test'}],colorId:'1'};
async function fixture(fn){const db=createDatabase(),previous=globalThis.fetch;let remote=structuredClone(source),patches=[],role='writer',account='owner@example.test',lose=false,race=false,wrong=false;
 try{
  const current=await readWorkspace(db,'a');await writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:current.revision,action:{type:'preferences.update',preferences:current.data.preferences}});
  await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  const rows=normalizeEvents([source],'Asia/Seoul','2026-09-01','2026-10-01'),id=rows[0].id;
  const cache=async events=>db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET events_json=excluded.events_json').bind('a',JSON.stringify(events),'Asia/Seoul','2026-09-01','2026-10-01','now').run();await cache(rows);
  globalThis.fetch=async(url,options={})=>{
   if(url.includes('/users/me/calendarList/'))return Response.json({id:account,accessRole:role});
   assert.ok(url.includes('/events/'+source.id),'must address only the selected occurrence');
   if(options.method==='PATCH'){
    assert.equal(options.headers['If-Match'],remote.etag);assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');const payload=JSON.parse(options.body);assert.deepEqual(Object.keys(payload),['colorId']);patches.push(payload);
    if(race)return Response.json({}, {status:412});
    if(!wrong)remote={...remote,...payload,etag:'"2"'};
    if(lose){lose=false;throw new Error('lost response')}
   }
   return Response.json(remote);
  };
  const save=async patch=>{const snapshot=await readWorkspace(db,'a'),command={operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'preferences.update',preferences:{...snapshot.data.preferences,...patch}}};await writeCommand(db,'a',command);return command};
  await fn({db,id,rows,cache,save,patches,get remote(){return remote},set remote(v){remote=v},set role(v){role=v},set account(v){account=v},set lose(v){lose=v},set race(v){race=v},set wrong(v){wrong=v}});
 }finally{globalThis.fetch=previous;db.close()}
}
test('an imported color save queues atomically, patches only color, and survives replay without a duplicate write',()=>fixture(async f=>{
 const command=await f.save({eventColors:{[f.id]:'#fbd75b'}});assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,1);
 await writeCommand(f.db,'a',command);await flushCalendarOutbox(f.db,'b',env);assert.equal(f.patches.length,0);
 assert.equal((await flushCalendarOutbox(f.db,'a',env)).verified,1);assert.equal(f.remote.colorId,'5');assert.equal(f.remote.summary,source.summary);assert.deepEqual(f.remote.start,source.start);assert.deepEqual(f.remote.attendees,source.attendees);assert.equal(f.remote.recurringEventId,'series');
 await queueGoogleColorBackfill(f.db,'a');await flushCalendarOutbox(f.db,'a',env);assert.equal(f.patches.length,1);
 await assert.rejects(()=>writeCommand(f.db,'a',{...command,operationId:randomUUID()}));assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,0);
}));
test('lost color ACK, cache eviction and date movement still reconcile the same resource once',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#f83a22'}});f.lose=true;assert.equal((await flushCalendarOutbox(f.db,'a',env)).failed,1);
 await f.cache([]);assert.equal((await flushCalendarOutbox(f.db,'a',env)).verified,1);assert.equal(f.patches.length,1);assert.equal(f.remote.colorId,'11');
}));
test('category palette uses the per-event override; automatic reset and category changes sync their effective color',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#fbd75b'}});await flushCalendarOutbox(f.db,'a',env);
 await f.save({categoryColors:{meeting:'#f83a22'}});assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,0);
 await f.save({eventColors:{[f.id]:null}});await flushCalendarOutbox(f.db,'a',env);assert.equal(f.remote.colorId,'11');
 await f.save({eventCategories:{[f.id]:'rest'}});await flushCalendarOutbox(f.db,'a',env);assert.equal(f.remote.colorId,'7');
}));
test('newly loaded events inherit explicit category choices without repainting unconfigured calendars',()=>fixture(async f=>{
 await queueGoogleColorBackfill(f.db,'a');assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,0);
 await f.cache([]);await f.save({categoryColors:{meeting:'#46d6db'}});assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,0);
 await f.cache(f.rows);await queueGoogleColorBackfill(f.db,'a');await queueGoogleColorBackfill(f.db,'a');assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,1);
 await flushCalendarOutbox(f.db,'a',env);assert.equal(f.remote.colorId,'7');
}));
test('rapid successive changes and concurrent flushers publish only the latest queued color',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#fbd75b'}});await f.save({eventColors:{[f.id]:'#dbadff'}});
 await Promise.all([flushCalendarOutbox(f.db,'a',env),flushCalendarOutbox(f.db,'a',env)]);assert.equal(f.patches.length,1);assert.equal(f.remote.colorId,'3');
}));
test('readonly calendars, changed accounts and ETag conflicts never silently overwrite or report success',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#f83a22'}});f.role='reader';assert.equal((await flushCalendarOutbox(f.db,'a',env)).failed,1);assert.equal(f.patches.length,0);
 f.role='writer';f.race=true;assert.equal((await flushCalendarOutbox(f.db,'a',env)).failed,1);assert.equal(f.remote.colorId,'1');
 f.race=false;f.account='different@example.test';await flushCalendarOutbox(f.db,'a',env);assert.equal(f.patches.length,1);assert.equal(f.remote.colorId,'1');
}));
test('a successful HTTP response with the wrong color is not marked verified',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#f83a22'}});f.wrong=true;assert.equal((await flushCalendarOutbox(f.db,'a',env)).failed,1);
 f.wrong=false;assert.equal((await flushCalendarOutbox(f.db,'a',env)).verified,1);
}));
test('cancelled Google events stay deleted; color retries cannot recreate them',()=>fixture(async f=>{
 await f.save({eventColors:{[f.id]:'#f83a22'}});f.remote={...f.remote,status:'cancelled'};const result=await flushCalendarOutbox(f.db,'a',env);assert.equal(result.failed,0);assert.equal(result.verified,0);assert.equal(f.patches.length,0);
 const row=await f.db.prepare('SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND event_id=?').bind('a',googleColorKey({calendarId:'primary',eventId:source.id})).first();assert.equal(JSON.parse(row.state_json).status,'cancelled');
}));

test('multi-day color changes keep every visible row consistent and queue one Google resource',()=>fixture(async f=>{
 const sibling={...f.rows[0],id:f.id.replace('2026-09-21','2026-09-22'),date:'2026-09-22'};await f.cache([...f.rows,sibling]);
 const command=await f.save({eventColors:{[f.id]:'#fbd75b'}});await writeCommand(f.db,'a',command);let snapshot=await readWorkspace(f.db,'a');assert.equal(snapshot.data.preferences.eventColors[sibling.id],'#fbd75b');
 await f.save({eventColors:{...snapshot.data.preferences.eventColors,[sibling.id]:'#dbadff'}});snapshot=await readWorkspace(f.db,'a');assert.equal(snapshot.data.preferences.eventColors[f.id],'#dbadff');
 await queueGoogleColorBackfill(f.db,'a');assert.equal((await calendarDeliveryStatus(f.db,'a')).pending,1);await flushCalendarOutbox(f.db,'a',env);assert.equal(f.remote.colorId,'3');assert.equal(f.patches.length,1);
}));
