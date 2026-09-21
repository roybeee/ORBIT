import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {normalizeEvents} from '../lib/orbit/agent/calendar.ts';
import {readCalendarEdit,saveCalendarEdit,calendarEditSchema} from '../lib/orbit/agent/calendar-edit.ts';
import {AgentRequestError} from '../lib/orbit/agent/approval-feedback.ts';
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')},date='2026-09-21';
const original=()=>({id:'meeting_instance_20260921',etag:'"v1"',summary:'정안식 대표 통화 · 제주도 관련 논의',start:{dateTime:date+'T10:00:00+09:00'},end:{dateTime:date+'T10:30:00+09:00'},recurringEventId:'master',description:'원래 설명',attendees:[{email:'guest@example.test'}],extendedProperties:{private:{existing:'keep'}}});
test('Google editing requires overlap consent, validates changing conflicts and reconciles a lost confirmed response',()=>fixture(async f=>{
 const input={...await f.edit(),start:800,end:825};let confirmation;
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,input),error=>{
  assert.equal(error.code,'OVERLAP');assert.match(error.message,/보존할 일정/);
  confirmation=new AgentRequestError(error.message,error.code,error.details).registrationConfirmation;
  assert.ok(confirmation);return true;
 });assert.equal(f.patches.length,0);
 const snapshot=await readWorkspace(f.db,'owner'),local=snapshot.data.events.find(e=>e.id==='local');
 await writeCommand(f.db,'owner',{operationId:randomUUID(),expectedRevision:snapshot.revision,action:{type:'event.upsert',event:{...local,title:'변경된 회의'}}});
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,{...input,operationId:randomUUID(),overlapConfirmation:confirmation}),error=>{assert.equal(error.code,'OVERLAP');assert.notEqual(error.details.confirmation,confirmation);confirmation=error.details.confirmation;return true});
 const confirmed={...input,operationId:randomUUID(),overlapConfirmation:confirmation};f.lose=true;
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,confirmed),error=>error.code==='UPSTREAM_NETWORK');
 await saveCalendarEdit(f.db,'owner',env,confirmed);await saveCalendarEdit(f.db,'owner',env,confirmed);
 assert.equal(f.patches.length,1);assert.equal((await readWorkspace(f.db,'owner')).data.events.length,2);
}));
async function fixture(fn){const db=createDatabase(),previous=globalThis.fetch;let live=original(),patches=[],role='owner',calendarId='owner@example.test',lose=false,race=false;
 try{
  await saveConnection(db,'owner','google_calendar',{clientId:'client',accessToken:'token',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY);
  await writeCommand(db,'owner',{operationId:randomUUID(),expectedRevision:0,action:{type:'event.upsert',event:{id:'local',title:'보존할 일정',date,start:800,end:830,kind:'meeting'}}});
  const rows=normalizeEvents([live],'Asia/Seoul','2026-09-01','2026-10-30'),id=rows[0].id;
  await db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) VALUES(?,?,?,?,?,?)').bind('owner',JSON.stringify(rows),'Asia/Seoul','2026-09-01','2026-10-30',new Date().toISOString()).run();
  globalThis.fetch=async(url,options={})=>{
   if(url.includes('/users/me/calendarList/'))return Response.json({id:calendarId,accessRole:role});
   assert.ok(url.includes('/events/meeting_instance_20260921'),'edit must address the selected occurrence');
   if(options.method==='PATCH'){
    patches.push(JSON.parse(options.body));assert.equal(new URL(url).searchParams.get('sendUpdates'),'none');
    if(race||options.headers['If-Match']!==live.etag)return Response.json({error:'precondition'},{status:412});
    const patch=patches.at(-1);live={...live,...patch,etag:'"v2"'};for(const field of ['start','end'])live[field]=Object.fromEntries(Object.entries(live[field]).filter(([,v])=>v!==null));
    if(lose){lose=false;throw new Error('lost acknowledgement')}
   }
   return Response.json(live);
  };
  const edit=async()=>{const {recurring,sourceCalendarId,...fields}=await readCalendarEdit(db,'owner',env,id);return {...fields,operationId:randomUUID()}};
  await fn({db,id,edit,patches,get live(){return live},set live(value){live=value},set role(value){role=value},set calendarId(value){calendarId=value},set lose(value){lose=value},set race(value){race=value}});
 }finally{globalThis.fetch=previous;db.close()}
}
test('editing a Google occurrence changes its title and times while preserving unrelated fields and other events',()=>fixture(async f=>{
 const view=await readCalendarEdit(f.db,'owner',env,f.id);assert.equal(view.recurring,true);assert.equal(view.start,600);assert.equal(view.end,630);
 const result=await saveCalendarEdit(f.db,'owner',env,{...await f.edit(),title:'제주도 후속 통화',start:660,end:705});
 assert.equal(f.patches.length,1);assert.equal(result.event.title,'제주도 후속 통화');assert.equal(result.event.start,660);
 assert.equal(f.live.description,'원래 설명');assert.equal(f.live.attendees.length,1);assert.equal(f.live.recurringEventId,'master');assert.equal(f.live.extendedProperties.private.existing,'keep');
 for(const key of ['recurrence','attendees'])assert.ok(!(key in f.patches[0]));
 const data=(await readWorkspace(f.db,'owner')).data;assert.equal(data.events.find(e=>e.id==='local').title,'보존할 일정');assert.equal(data.events.find(e=>e.google)?.title,'제주도 후속 통화');
}));
test('moving a Google event preserves its attachments, category and custom color',()=>fixture(async f=>{
 let current=await readWorkspace(f.db,'owner');await writeCommand(f.db,'owner',{operationId:randomUUID(),expectedRevision:current.revision,action:{type:'project.upsert',project:{id:'jeju',name:'제주도',keywords:['제주'],color:'#5558e8',symbol:'J',goal:'일정 연결 검증',due:'2026-10-01',priority:3}}});current=await readWorkspace(f.db,'owner');assert.equal(current.data.events.find(e=>e.id===f.id).projectId,'jeju');await writeCommand(f.db,'owner',{operationId:randomUUID(),expectedRevision:current.revision,action:{type:'preferences.update',preferences:{...current.data.preferences,eventColors:{[f.id]:'#FF0000'},eventCategories:{[f.id]:'meeting'}}}});
 await f.db.prepare("INSERT INTO orbit_attachments(owner_id,id,name,mime,size,state,target_type,target_id,created_at,updated_at) VALUES('owner','file','회의자료','text/plain',1,'ready','event',?,?,?)").bind(f.id,'now','now').run();
 const result=await saveCalendarEdit(f.db,'owner',env,{...await f.edit(),startDate:'2026-09-23',endDate:'2026-09-23'});
 const data=(await readWorkspace(f.db,'owner')).data;assert.equal(data.events.some(e=>e.id===f.id),false);assert.equal(data.preferences.eventColors[result.event.id],'#FF0000');assert.equal(data.preferences.eventCategories[result.event.id],'meeting');assert.equal(data.events.find(e=>e.id===result.event.id).projectId,'jeju');
 assert.equal((await f.db.prepare("SELECT target_id FROM orbit_attachments WHERE id='file'").first()).target_id,result.event.id);
}));
test('lost PATCH response is reconciled once, even when background sync has removed the old date-based ID',()=>fixture(async f=>{
 const input={...await f.edit(),startDate:'2026-09-23',endDate:'2026-09-23'};f.lose=true;
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,input),e=>e.code==='UPSTREAM_NETWORK');
 await f.db.prepare('UPDATE orbit_calendar_cache SET events_json=? WHERE owner_id=?').bind(JSON.stringify(normalizeEvents([f.live],'Asia/Seoul','2026-09-01','2026-10-30')),'owner').run();
 await saveCalendarEdit(f.db,'owner',env,input);await saveCalendarEdit(f.db,'owner',env,input);assert.equal(f.patches.length,1);
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,{...input,title:'different'}),e=>e.code==='CONFLICT');
}));
test('cross-owner access, stale revisions, readonly calendars and changed Google accounts cannot overwrite events',()=>fixture(async f=>{
 await assert.rejects(()=>readCalendarEdit(f.db,'other',env,f.id),e=>e.code==='NOT_FOUND');
 const input=await f.edit();f.live={...f.live,etag:'"someone-else"',summary:'다른 기기의 수정'};
 await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,input),e=>e.code==='CONFLICT');assert.equal(f.patches.length,0);
 f.role='reader';await assert.rejects(()=>readCalendarEdit(f.db,'owner',env,f.id),e=>e.code==='CALENDAR_READ_ONLY'&&e.status===409);f.role='owner';
 const next=await f.edit();f.calendarId='another@example.test';await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,next),e=>e.code==='CONFLICT');assert.equal(f.patches.length,0);
}));
test('a concurrent Google write between read and PATCH is rejected by If-Match',()=>fixture(async f=>{
 const input=await f.edit();f.race=true;await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,input),e=>e.code==='CONFLICT');assert.equal(f.live.summary,original().summary);assert.equal((await readWorkspace(f.db,'owner')).data.events.find(e=>e.id===f.id).start,600);
}));
test('all-day multi-day editing uses an exclusive provider end date and supports switching back to time slots',()=>fixture(async f=>{
 const result=await saveCalendarEdit(f.db,'owner',env,{...await f.edit(),allDay:true,startDate:'2026-09-23',endDate:'2026-09-25'});
 assert.deepEqual(f.patches[0].start,{date:'2026-09-23',dateTime:null,timeZone:null});assert.equal(f.patches[0].end.date,'2026-09-26');assert.equal(result.event.allDay,true);
 const {recurring,sourceCalendarId,...fields}=await readCalendarEdit(f.db,'owner',env,result.event.id);
 await saveCalendarEdit(f.db,'owner',env,{...fields,operationId:randomUUID(),allDay:false,startDate:'2026-09-23',endDate:'2026-09-23',start:540,end:570});assert.equal(f.patches[1].start.date,null);assert.equal(f.live.start.date,undefined);assert.equal(f.live.start.dateTime,'2026-09-23T00:00:00.000Z');
}));
test('end dates and times are validated before a Google mutation',()=>fixture(async f=>{
 const input=await f.edit();assert.equal(calendarEditSchema.safeParse({...input,end:input.start}).success,false);assert.equal(calendarEditSchema.safeParse({...input,endDate:'2026-09-20'}).success,false);
 assert.equal(calendarEditSchema.safeParse({...input,endDate:'2026-09-22',end:30}).success,true);assert.equal(f.patches.length,0);
}));

test('Google memo and scope are read, edited, cached and cleared without losing other private metadata',()=>fixture(async f=>{
 const before=await readCalendarEdit(f.db,'owner',env,f.id);assert.equal(before.description,'원래 설명');assert.equal(before.scope,'personal');
 const memo='통화 목적: 발송 일정 확인\n준비: 계약서 검토\nhttps://example.test/reference';
 const saved=await saveCalendarEdit(f.db,'owner',env,{...await f.edit(),description:memo,scope:'work'});assert.equal(f.live.description,memo);assert.equal(f.live.extendedProperties.private.orbitScope,'work');assert.equal(f.live.extendedProperties.private.existing,'keep');assert.equal(saved.event.scope,'work');assert.equal(saved.event.description,memo);
 const read=await readCalendarEdit(f.db,'owner',env,saved.event.id);assert.equal(read.description,memo);assert.equal(read.scope,'work');
 await saveCalendarEdit(f.db,'owner',env,{...await f.edit(),description:'',scope:'other'});assert.equal(f.live.description,'');assert.equal(f.live.extendedProperties.private.orbitScope,'other');
 const cached=(await readWorkspace(f.db,'owner')).data.events.find(e=>e.id===f.id);assert.equal(cached.description,'');assert.equal(cached.scope,'other');
}));
test('old clients that omit memo and scope preserve both Google fields',()=>fixture(async f=>{
 f.live={...f.live,extendedProperties:{private:{orbitScope:'work',existing:'keep'}}};
 const {description,scope,...legacy}=await f.edit();await saveCalendarEdit(f.db,'owner',env,{...legacy,title:'제목만 수정'});assert.ok(!('description' in f.patches[0]));assert.equal(f.live.description,'원래 설명');assert.equal(f.live.extendedProperties.private.orbitScope,'work');
}));
test('memo and classification survive a lost response and remain protected by the event ETag',()=>fixture(async f=>{
 const input={...await f.edit(),description:'새 메모',scope:'work'};f.lose=true;await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,input));
 const saved=await saveCalendarEdit(f.db,'owner',env,input);assert.equal(f.patches.length,1);assert.equal(saved.event.description,'새 메모');assert.equal(saved.event.scope,'work');
 const stale=await f.edit();f.live={...f.live,etag:'"external"',description:'다른 기기 메모'};await assert.rejects(()=>saveCalendarEdit(f.db,'owner',env,{...stale,description:'덮어쓰기'}),e=>e.code==='CONFLICT');assert.equal(f.live.description,'다른 기기 메모');
}));
