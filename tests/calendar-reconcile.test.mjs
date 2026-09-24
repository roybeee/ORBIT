import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createDatabase} from './sqlite-d1.mjs';
import {readWorkspace,writeCommand} from '../db/repository.ts';
import {saveConnection} from '../lib/orbit/agent/secrets.ts';
import {flushCalendarOutbox} from '../lib/orbit/agent/calendar-outbox.ts';
import {calendarExports} from '../lib/orbit/agent/calendar-export.ts';
import {syncCalendar} from '../lib/orbit/agent/calendar.ts';

// Two-way sync for events ORBIT created in Google: edits and deletions made in Google come back,
// and deleting in ORBIT removes the Google copy.
const env={ORBIT_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const event={id:'meeting',title:'Planning',date:'2026-10-08',start:600,end:660,kind:'meeting'};
const day='2026-10-08';
const BLOCK='00000000-0000-4000-8000-000000000001';
async function fixture(fn){const db=createDatabase(),original=globalThis.fetch;try{await fn(db)}finally{globalThis.fetch=original;db.close()}}
async function connect(db){await saveConnection(db,'a','google_calendar',{accessToken:'test',expiresAt:Date.now()+3600000},{connected:true},env.ORBIT_ENCRYPTION_KEY)}
async function act(db,action){const snapshot=await readWorkspace(db,'a');return writeCommand(db,'a',{operationId:randomUUID(),expectedRevision:snapshot.revision,action})}
const local=async db=>(await readWorkspace(db,'a')).data.events.filter(e=>!e.id.startsWith('google:'));
const shown=async db=>(await readWorkspace(db,'a')).data.events;

// A small stateful Google Calendar: one primary calendar keyed by event id.
function google(){
 const events=new Map();let etag=0;const calls=[];
 const iso=(date,minute)=>new Date(Date.parse(`${date}T00:00:00+09:00`)+minute*60000).toISOString();
 globalThis.fetch=async(url,init={})=>{
  const method=init.method??'GET',u=new URL(url);calls.push(method+' '+u.pathname);
  if(u.pathname.endsWith('/calendarList/primary'))return Response.json({id:'owner@example.test'});
  const match=/\/calendars\/[^/]+\/events(?:\/([^/?]+))?$/.exec(u.pathname);if(!match)throw new Error('Unexpected '+url);
  const id=match[1]&&decodeURIComponent(match[1]);
  if(!id&&method==='GET'){const min=Date.parse(u.searchParams.get('timeMin')),max=Date.parse(u.searchParams.get('timeMax'));
   return Response.json({items:[...events.values()].filter(e=>e.status!=='cancelled').filter(e=>{const s=Date.parse(e.start.dateTime??e.start.date+'T00:00:00+09:00');return s>=min&&s<max})})}
  if(!id&&method==='POST'){const value={...JSON.parse(init.body),etag:`"${++etag}"`,status:'confirmed',htmlLink:'https://calendar.google.com/x'};events.set(value.id,value);return Response.json(value)}
  const current=events.get(id);
  if(method==='GET')return current?Response.json(current):Response.json({},{status:404});
  if(method==='DELETE'){events.delete(id);return new Response(null,{status:204})}
  if(method==='PATCH'){if(init.headers['If-Match']!==current.etag)return Response.json({},{status:412});const value={...current,...JSON.parse(init.body),etag:`"${++etag}"`};events.set(id,value);return Response.json(value)}
  throw new Error('Unexpected '+method+' '+url);
 };
 return {events,calls,
  only(){assert.equal(events.size,1);return [...events.values()][0]},
  edit(changes){const e=this.only();events.set(e.id,{...e,...changes,etag:`"${++etag}"`})},
  move(date,start,end){this.edit({start:{dateTime:iso(date,start),timeZone:'Asia/Seoul'},end:{dateTime:iso(date,end),timeZone:'Asia/Seoul'}})},
  remove(){events.clear()}};
}
async function published(db){await connect(db);const g=google();await act(db,{type:'event.upsert',event});await flushCalendarOutbox(db,'a',env,'meeting');assert.equal(g.only().summary,'Planning');return g}

test('deleting an ORBIT event also deletes its Google copy',()=>fixture(async db=>{
 const g=await published(db);
 await act(db,{type:'event.delete',id:'meeting'});
 await flushCalendarOutbox(db,'a',env,'meeting');
 assert.equal(g.events.size,0);
 assert.equal((await calendarExports(db,'a')).find(r=>r.eventId==='meeting').status,'cancelled');
}));

test('an unpublished event deleted in ORBIT never touches Google',()=>fixture(async db=>{
 await connect(db);const g=google();
 await act(db,{type:'event.upsert',event});await act(db,{type:'event.delete',id:'meeting'});
 await flushCalendarOutbox(db,'a',env,'meeting');
 assert.equal(g.events.size,0);assert.ok(!g.calls.some(c=>c.startsWith('POST')));
}));

test('a Google edit of an ORBIT event is adopted, shows once, and later ORBIT edits still reach Google',()=>fixture(async db=>{
 const g=await published(db);
 g.edit({summary:'Planning (moved)',description:'Google 메모'});g.move(day,840,900);
 await syncCalendar(db,'a',env,day);
 const [mine]=await local(db);
 assert.deepEqual([mine.title,mine.date,mine.start,mine.end,mine.description],['Planning (moved)',day,840,900,'Google 메모']);
 assert.equal((await shown(db)).filter(e=>e.title==='Planning (moved)').length,1,'no duplicate Google copy');
 await act(db,{type:'event.upsert',event:{...mine,title:'Planning v3'}});
 await flushCalendarOutbox(db,'a',env,'meeting');
 assert.equal(g.only().summary,'Planning v3');
 assert.equal((await calendarExports(db,'a')).find(r=>r.eventId==='meeting').status,'verified');
}));

test('an ORBIT event deleted in Google is removed from ORBIT and not recreated',()=>fixture(async db=>{
 const g=await published(db);
 g.remove();
 await syncCalendar(db,'a',env,day);
 assert.equal((await local(db)).length,0);
 await flushCalendarOutbox(db,'a',env,'meeting');
 assert.equal(g.events.size,0,'the deletion is not undone');
}));

test('an ORBIT event moved in Google outside the synced window is followed, not deleted',()=>fixture(async db=>{
 const g=await published(db);
 g.move('2026-12-20',600,660);
 await syncCalendar(db,'a',env,day);
 const [mine]=await local(db);
 assert.equal(mine.date,'2026-12-20');
}));

test('a local change still waiting for delivery is not overwritten by Google',()=>fixture(async db=>{
 const g=await published(db);
 g.edit({summary:'Changed in Google'});
 await act(db,{type:'event.upsert',event:{...event,title:'Changed in ORBIT'}});
 await syncCalendar(db,'a',env,day);
 assert.equal((await local(db))[0].title,'Changed in ORBIT');
}));

test('an ORBIT event turned all-day in Google is left as it is in ORBIT',()=>fixture(async db=>{
 const g=await published(db);
 g.edit({start:{date:day},end:{date:'2026-10-09'}});
 await syncCalendar(db,'a',env,day);
 const [mine]=await local(db);
 assert.deepEqual([mine.start,mine.end],[600,660]);
}));

test('settled events without memos and task blocks are not rewritten on every sync',()=>fixture(async db=>{
 const g=await published(db);
 assert.equal(g.only().description,'Orbit에서 등록한 일정','the outbox placeholder is present in Google');
 await act(db,{type:'project.upsert',project:{id:'hr',name:'채용',goal:'채용',due:'2026-12-31',priority:3,color:'#5484ed',symbol:'H'}});
 await act(db,{type:'task.upsert',task:{id:'t1',title:'집중 업무',projectId:'hr',status:'todo',due:day,duration:60,impact:3,focus:false,definition:''}});
 await act(db,{type:'task.schedule',taskId:'t1',eventId:BLOCK,date:day,start:780,minutes:60});
 await flushCalendarOutbox(db,'a',env,BLOCK);
 g.events.forEach((e,id)=>{if(e.extendedProperties?.private?.orbitEventId===BLOCK)g.events.set(id,{...e,summary:'Google에서 바꾼 제목'})});
 await syncCalendar(db,'a',env,day);
 const before=(await readWorkspace(db,'a')).revision;
 await syncCalendar(db,'a',env,day);await syncCalendar(db,'a',env,day);
 assert.equal((await readWorkspace(db,'a')).revision,before,'no workspace write once both sides agree');
 const meeting=(await local(db)).find(e=>e.id==='meeting');
 assert.equal(meeting.description,undefined,'the placeholder is not copied into ORBIT');
 assert.equal((await local(db)).find(e=>e.id===BLOCK).title,'집중 업무','a task block keeps the task title');
}));

test('after reconnecting another Google account, ORBIT events are never deleted',()=>fixture(async db=>{
 const g=await published(db);
 const inner=globalThis.fetch;
 globalThis.fetch=async(url,init)=>new URL(url).pathname.endsWith('/calendarList/primary')?Response.json({id:'someone-else@example.test'}):inner(url,init);
 g.remove();
 await syncCalendar(db,'a',env,day);
 assert.equal((await local(db)).length,1);
}));

test('deleting a task also removes its scheduled block from Google',()=>fixture(async db=>{
 const g=await published(db);
 await act(db,{type:'project.upsert',project:{id:'hr',name:'채용',goal:'채용',due:'2026-12-31',priority:3,color:'#5484ed',symbol:'H'}});
 await act(db,{type:'task.upsert',task:{id:'t1',title:'집중 업무',projectId:'hr',status:'todo',due:day,duration:60,impact:3,focus:false,definition:''}});
 await act(db,{type:'task.schedule',taskId:'t1',eventId:BLOCK,date:day,start:780,minutes:60});
 await flushCalendarOutbox(db,'a',env,BLOCK);
 const blocks=()=>[...g.events.values()].filter(e=>e.extendedProperties?.private?.orbitEventId===BLOCK);
 assert.equal(blocks().length,1);
 await act(db,{type:'task.delete',id:'t1'});
 await flushCalendarOutbox(db,'a',env,BLOCK);
 assert.equal(blocks().length,0);
}));
