import {prepareWorkspace} from '../../../db/workspace-storage.ts';
import {overlapReview} from '../overlap-review.ts';
import {eventScopes,eventScope,storedEventScope} from '../event-details.ts';
import {z} from 'zod';
import {readWorkspace,type Database} from '../../../db/repository.ts';
import {dateSchema} from '../validation.ts';
import {addDays} from '../dates.ts';
import type {CalendarEvent} from '../model.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {normalizeEvents,zonedInstant,type GoogleEvent} from './calendar.ts';
import {AgentError} from './errors.ts';
const base='https://www.googleapis.com/calendar/v3';
const eventPath=(calendar:string,id:string)=>base+'/calendars/'+encodeURIComponent(calendar)+'/events/'+encodeURIComponent(id);
export const calendarEditSchema=z.object({
 operationId:z.string().uuid(),id:z.string().min(1).max(2500),calendarId:z.string().min(1).max(1024),eventId:z.string().min(1).max(1024),etag:z.string().min(1).max(1024),timeZone:z.string().min(1).max(100),
 title:z.string().trim().min(1).max(160),startDate:dateSchema,endDate:dateSchema,allDay:z.boolean(),start:z.number().int().min(0).max(1439),end:z.number().int().min(0).max(1439),
 description:z.string().max(20000).optional(),scope:z.enum(eventScopes).optional(),overlapConfirmation:z.string().max(1000000).optional(),
}).strict().refine(v=>v.endDate>=v.startDate&&(v.allDay||v.endDate>v.startDate||v.end>v.start),'종료 시간을 시작 시간 이후로 선택해 주세요.').refine(v=>Date.parse(v.endDate)-Date.parse(v.startDate)<=366*86400000,'일정 기간은 1년 이내로 선택해 주세요.');
export type CalendarEdit=z.infer<typeof calendarEditSchema>;
function check(response:Response){
 if(response.status===401)throw new AgentError('Google Calendar를 다시 연결해 주세요.','RECONNECT',409);
 if(response.status===403)throw new AgentError('이 캘린더의 수정 권한이 없습니다. Google 연결 권한을 확인해 주세요.','CALENDAR_READ_ONLY',409);
 if([404,410].includes(response.status))throw new AgentError('일정이 삭제되었거나 더 이상 접근할 수 없습니다.','NOT_FOUND',404);
 if(response.status===400)throw new AgentError('Google에서 이 일정의 변경을 허용하지 않았습니다. 날짜와 시간, 일정 종류를 확인해 주세요.','INPUT',400);
 if(response.status===412)throw new AgentError('다른 곳에서 일정이 변경되었습니다. 최신 일정을 불러온 뒤 수정해 주세요.','CONFLICT',409);
 if(!response.ok)throw new AgentError('Google의 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.','CALENDAR',502);
}
async function calendar(token:string,source:string){const result=await fetchJson(base+'/users/me/calendarList/'+encodeURIComponent(source),{headers:{Authorization:'Bearer '+token}});check(result.response);if(!['owner','writer'].includes(result.data.accessRole))throw new AgentError('읽기 전용 캘린더입니다. 수정 권한이 있는 일정만 변경할 수 있습니다.','CALENDAR_READ_ONLY',409);return result.data.id as string}
function dateFields(value:{date?:string;dateTime?:string},timeZone:string){
 if(value.date)return {date:value.date,minute:0};
 const instant=new Date(value.dateTime??'');if(!Number.isFinite(+instant))throw new AgentError('일정 시간을 읽지 못했습니다.','CALENDAR',502);
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant).map(p=>[p.type,p.value]));
 return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};
}
function fields(event:GoogleEvent,timeZone:string){const start=dateFields(event.start,timeZone),end=dateFields(event.end,timeZone),allDay=!!event.start.date;return {title:String(event.summary??'비공개 일정').slice(0,160),startDate:start.date,endDate:allDay?addDays(end.date,-1):end.date,start:start.minute,end:end.minute,allDay}}
export async function readCalendarEdit(db:Database,owner:string,env:Runtime,id:string){
 const snapshot=await readWorkspace(db,owner),cached=snapshot.data.events.find(e=>e.id===id);
 if(!cached?.google)throw new AgentError('일정을 새로 불러온 뒤 다시 선택해 주세요.','NOT_FOUND',404);
 if(cached.google.orbitEventId&&snapshot.data.events.some(e=>e.id===cached.google!.orbitEventId))throw new AgentError('ORBIT에서 연결된 원래 일정을 수정해 주세요.','MANAGED_EVENT',409);
 const token=await accessToken(db,owner,'google_calendar',env),calendarId=await calendar(token,cached.google.calendarId);
 const live=await fetchJson(eventPath(calendarId,cached.google.eventId),{headers:{Authorization:'Bearer '+token}});check(live.response);
 if(live.data.id!==cached.google.eventId||live.data.status==='cancelled'||!live.data.etag)throw new AgentError('현재 수정할 일정을 확인하지 못했습니다.','NOT_FOUND',404);
 // Only a concrete occurrence can be edited; never silently change a series master.
 if(live.data.recurrence?.length&&!live.data.recurringEventId)throw new AgentError('반복 일정에서 수정할 날짜를 선택해 주세요.','INPUT',422);
 return {id,calendarId,eventId:live.data.id as string,etag:live.data.etag as string,timeZone:snapshot.data.preferences.timeZone,...fields(live.data as GoogleEvent,snapshot.data.preferences.timeZone),description:String(live.data.description??''),scope:storedEventScope(live.data.extendedProperties?.private?.orbitScope)??eventScope(cached),recurring:!!live.data.recurringEventId,sourceCalendarId:cached.google.calendarId};
}
// Update just this Google resource in the owner cache; local events remain untouched.
// Date-based attachment/appearance keys move in the same workspace CAS transaction.
async function cacheEdit(db:Database,owner:string,input:CalendarEdit,sourceCalendarId:string,event:GoogleEvent){
 for(let attempt=0;attempt<3;attempt++){
  const snapshot=await readWorkspace(db,owner),cache=await db.prepare('SELECT events_json,time_zone FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first<{events_json:string;time_zone:string}>();
  if(!cache||cache.time_zone!==snapshot.data.preferences.timeZone)throw new AgentError('일정 목록을 다시 불러와 주세요.','STORAGE',503);
  const old:CalendarEvent[]=JSON.parse(cache.events_json),timeZone=snapshot.data.preferences.timeZone,range=fields(event,timeZone);
  const next=normalizeEvents([{...event,orbitCalendarId:sourceCalendarId}],timeZone,range.startDate,addDays(range.endDate,1));
  if(!next.length)throw new AgentError('수정한 일정 표시를 확인하지 못했습니다.','STORAGE',503);
  const related=old.filter(e=>e.google?.calendarId===sourceCalendarId&&e.google.eventId===input.eventId),ids=[...new Set([input.id,...related.map(e=>e.id)])];
  const data=structuredClone(snapshot.data);data.events=data.events.filter(e=>!e.id.startsWith('google:'));
  for(const field of ['eventColors','eventCategories'] as const){const map=data.preferences[field];if(map){const value=ids.map(id=>map[id]).find(v=>v!==undefined);for(const id of ids)delete map[id];if(value!==undefined)for(const row of next)(map as Record<string,unknown>)[row.id]=value;}}
  const now=new Date().toISOString(),mutation=crypto.randomUUID(),revision=snapshot.revision+1,storage=prepareWorkspace(data);
  const gate='EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?)';
  const result=await db.batch([
   db.prepare('UPDATE orbit_workspaces SET revision=?,state_json=?,mutation_id=?,updated_at=? WHERE owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM orbit_calendar_cache WHERE owner_id=? AND events_json=?)').bind(revision,storage.stateJson,mutation,now,owner,snapshot.revision,owner,cache.events_json),
   ...storage.statements(db,owner,gate,[owner,revision,mutation]),
   db.prepare(`UPDATE orbit_calendar_cache SET events_json=?,time_zone=?,updated_at=? WHERE owner_id=? AND ${gate}`).bind(JSON.stringify([...old.filter(e=>!ids.includes(e.id)),...next].sort((a,b)=>a.id.localeCompare(b.id))),timeZone,now,owner,owner,revision,mutation),
   ...ids.filter(id=>id!==next[0].id).map(id=>db.prepare(`UPDATE orbit_attachments SET target_id=?,updated_at=? WHERE owner_id=? AND target_type='event' AND target_id=? AND ${gate}`).bind(next[0].id,now,owner,id,owner,revision,mutation)),
  ]);
  if(result[0].meta?.changes===1)return next[0];
 }
 throw new AgentError('Google에는 저장됐습니다. 일정 목록을 다시 확인해 주세요.','STORAGE',503);
}
export async function saveCalendarEdit(db:Database,owner:string,env:Runtime,value:CalendarEdit){
 const input=calendarEditSchema.parse(value),payload=JSON.stringify(input);
 type Row={payload_json:string;source_calendar_id:string;result_json:string;lease_until:number};
 const read=()=>db.prepare('SELECT * FROM orbit_calendar_edits WHERE owner_id=? AND operation_id=?').bind(owner,input.operationId).first<Row>();
 let row=await read();
 if(!row){const current=await readCalendarEdit(db,owner,env,input.id);if(current.calendarId!==input.calendarId||current.eventId!==input.eventId||current.etag!==input.etag||current.timeZone!==input.timeZone)throw new AgentError('일정이 변경되었습니다. 최신 내용을 불러온 뒤 수정해 주세요.','CONFLICT',409);
  await db.prepare("INSERT OR IGNORE INTO orbit_calendar_edits(owner_id,operation_id,payload_json,source_calendar_id,result_json,lease_until) VALUES(?,?,?,?,'{}',0)").bind(owner,input.operationId,payload,current.sourceCalendarId).run();row=(await read())!;
 }
 if(row.payload_json!==payload)throw new AgentError('이전 저장 결과를 먼저 확인해 주세요.','CONFLICT',409);
 const lease=Date.now()+180000,claimed=await db.prepare('UPDATE orbit_calendar_edits SET lease_until=? WHERE owner_id=? AND operation_id=? AND lease_until<?').bind(lease,owner,input.operationId,Date.now()).run();
 if(claimed.meta?.changes!==1)throw new AgentError('저장 결과를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.','BUSY',409);
 try{
  const token=await accessToken(db,owner,'google_calendar',env);if(await calendar(token,row.source_calendar_id)!==input.calendarId)throw new AgentError('Google 계정이 바뀌었습니다. 일정을 다시 불러와 주세요.','CONFLICT',409);
  const headers={Authorization:'Bearer '+token},url=eventPath(input.calendarId,input.eventId),live=await fetchJson(url,{headers});check(live.response);
  if(live.data.id!==input.eventId||live.data.status==='cancelled')throw new AgentError('일정이 삭제되었습니다.','NOT_FOUND',404);
  let saved=live.data;
  const completed=JSON.parse(row.result_json).verified===true;
  if(!completed&&live.data.extendedProperties?.private?.orbitEditId!==input.operationId){
   if(live.data.etag!==input.etag)throw new AgentError('다른 곳에서 일정이 변경되었습니다. 최신 내용을 불러온 뒤 수정해 주세요.','CONFLICT',409);
   const previous=fields(live.data as GoogleEvent,input.timeZone);
   if(previous.startDate!==input.startDate||previous.endDate!==input.endDate||previous.start!==input.start||previous.end!==input.end||previous.allDay!==input.allDay){
    const snapshot=await readWorkspace(db,owner);
    if(snapshot.data.preferences.timeZone!==input.timeZone)throw new AgentError('시간대가 변경되었습니다. 최신 일정을 불러와 주세요.','CONFLICT',409);
    const review=overlapReview(input,snapshot.data.events.filter(e=>!(e.google?.eventId===input.eventId&&[row.source_calendar_id,input.calendarId].includes(e.google.calendarId))));
    if(review&&input.overlapConfirmation!==review.confirmation)throw new AgentError(review.message,'OVERLAP',409,{confirmation:review.confirmation});
   }
   const start=input.allDay?{date:input.startDate,dateTime:null,timeZone:null}:{date:null,dateTime:zonedInstant(input.startDate,input.start,input.timeZone),timeZone:input.timeZone};
   const end=input.allDay?{date:addDays(input.endDate,1),dateTime:null,timeZone:null}:{date:null,dateTime:zonedInstant(input.endDate,input.end,input.timeZone),timeZone:input.timeZone};
   const changed=await fetchJson(url+'?sendUpdates=none',{method:'PATCH',headers:{...headers,'Content-Type':'application/json','If-Match':input.etag},body:JSON.stringify({summary:input.title,start,end,...(input.description!==undefined?{description:input.description}:{}),extendedProperties:{private:{...live.data.extendedProperties?.private,orbitEditId:input.operationId,...(input.scope!==undefined?{orbitScope:input.scope}:{})}}})});check(changed.response);saved=changed.data;
   if(input.description!==undefined&&(saved.description??'')!==input.description||input.scope!==undefined&&saved.extendedProperties?.private?.orbitScope!==input.scope)throw new AgentError('메모와 일정 구분의 저장 결과를 다시 확인해 주세요.','CALENDAR',502);
  }
  if(saved.id!==input.eventId||!saved.start||!saved.end)throw new AgentError('저장 응답을 확인하지 못했습니다. 같은 내용으로 다시 확인해 주세요.','CALENDAR',502);
  await db.prepare('UPDATE orbit_calendar_edits SET result_json=? WHERE owner_id=? AND operation_id=? AND lease_until=?').bind(JSON.stringify({verified:true}),owner,input.operationId,lease).run();
  const event=await cacheEdit(db,owner,input,row.source_calendar_id,saved as GoogleEvent);return {ok:true,event};
 }finally{await db.prepare('UPDATE orbit_calendar_edits SET lease_until=0 WHERE owner_id=? AND operation_id=? AND lease_until=?').bind(owner,input.operationId,lease).run()}
}
