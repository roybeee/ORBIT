import {readWorkspace,RevisionConflict,type Database} from '../../../db/repository.ts';
import {addDays,todayInZone,validDate} from '../dates.ts';
import type {CalendarEvent} from '../model.ts';
import {overlaps} from '../planner.ts';
import {accessToken,connections,fetchJson,type Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';
import type {GoogleEventAction} from './types.ts';
export interface GoogleEvent {id:string;summary?:string;status?:string;transparency?:string;attendees?:{self?:boolean;responseStatus?:string}[];start:{date?:string;dateTime?:string};end:{date?:string;dateTime?:string};htmlLink?:string;extendedProperties?:{private?:Record<string,string>}}
const parts=(time:Date,timeZone:string)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
export function zonedInstant(date:string,minute:number,timeZone:string){const target=Date.parse(`${date}T00:00:00Z`)+minute*60000;let utc=target;for(let i=0;i<4;i++){const p=parts(new Date(utc),timeZone),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);if(local===target)return new Date(utc).toISOString();utc+=target-local}throw new AgentError('해당 시간대에서 존재하지 않는 시각입니다. 시간을 조정해 주세요.');}
export function normalizeEvents(items:GoogleEvent[],timeZone:string,from:string,to:string):CalendarEvent[]{
 const out:CalendarEvent[]=[];
 for(const event of items){if(!event.id||event.status==='cancelled'||event.transparency==='transparent'||event.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;
  let first:string,last:string,start=0,end=1440;
  if(event.start.date&&event.end.date){first=event.start.date;last=addDays(event.end.date,-1)}else{const a=new Date(event.start.dateTime??''),b=new Date(event.end.dateTime??'');if(!Number.isFinite(+a)||!Number.isFinite(+b)||+b<=+a)continue;const p=parts(a,timeZone),q=parts(new Date(Math.ceil(+b/60000)*60000),timeZone);first=`${p.year}-${p.month}-${p.day}`;last=`${q.year}-${q.month}-${q.day}`;start=Number(p.hour)*60+Number(p.minute);end=Number(q.hour)*60+Number(q.minute);if(end===0){last=addDays(last,-1);end=1440}}
  if(!validDate(first)||!validDate(last))continue;
  for(let date=first<from?from:first;date<=last&&date<to;date=addDays(date,1)){const a=date===first?start:0,b=date===last?end:1440;if(b>a)out.push({id:`google:${event.id}:${date}`,title:(event.summary??'비공개 일정').slice(0,160),date,start:a,end:b,kind:'meeting'});}
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id));
}
export async function googleEvents(db:Database,owner:string,env:Runtime,from:string,to:string,timeZone:string){
 const token=await accessToken(db,owner,'google_calendar',env),items:GoogleEvent[]=[];let page='';
 for(let n=0;n<10;n++){
  const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');url.search=new URLSearchParams({timeMin:zonedInstant(from,0,timeZone),timeMax:zonedInstant(to,0,timeZone),timeZone,singleEvents:'true',showDeleted:'false',maxResults:'250',...(page?{pageToken:page}:{})}).toString();
  const {response,data}=await fetchJson(url.href,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw new AgentError('Google 일정을 불러오지 못했습니다. 연결을 확인해 주세요.','CALENDAR',502);items.push(...(data.items??[]));page=data.nextPageToken??'';if(!page)return items;
 }
 throw new AgentError('일정이 많아 조회를 끝내지 못했습니다. 조회 기간을 줄여 주세요.','CALENDAR',422);
}
export async function syncCalendar(db:Database,owner:string,env:Runtime,date?:string){
 if(!(await connections(db,owner,env)).find(c=>c.provider==='google_calendar')?.connected){if(await db.prepare('SELECT owner_id FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first())throw new AgentError('Google Calendar를 다시 연결해 최신 일정을 확인해 주세요.','RECONNECT',409);return {connected:false,count:0};}
 const snapshot=await readWorkspace(db,owner),timeZone=snapshot.data.preferences.timeZone,day=date??todayInZone(timeZone),from=addDays(day,-7),to=addDays(day,31);
 const events=normalizeEvents(await googleEvents(db,owner,env,from,to,timeZone),timeZone,from,to);const serialized=JSON.stringify(events);if(new TextEncoder().encode(serialized).length>700000)throw new AgentError('일정의 크기가 너무 큽니다.','CALENDAR',422);
 const previous=await db.prepare('SELECT events_json,time_zone FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first<{events_json:string;time_zone:string}>();const now=new Date().toISOString();
 if(previous?.events_json===serialized&&previous.time_zone===timeZone){await db.prepare('UPDATE orbit_calendar_cache SET updated_at=?,range_start=?,range_end=? WHERE owner_id=?').bind(now,from,to,owner).run();return {connected:true,count:events.length,updatedAt:now}}
 const data={...snapshot.data,events:snapshot.data.events.filter(e=>!e.id.startsWith('google:'))},id=crypto.randomUUID(),revision=snapshot.revision+1;
 const result=await db.batch([
  db.prepare('INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=?').bind(owner,revision,JSON.stringify(data),id,now,snapshot.revision),
  db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?) ON CONFLICT(owner_id) DO UPDATE SET events_json=excluded.events_json,time_zone=excluded.time_zone,range_start=excluded.range_start,range_end=excluded.range_end,updated_at=excluded.updated_at').bind(owner,serialized,timeZone,from,to,now,owner,revision,id),
 ]);if(result[0].meta?.changes!==1)throw new RevisionConflict('일정을 확인하는 동안 업무가 변경됐습니다. 다시 동기화해 주세요.');return {connected:true,count:events.length,updatedAt:now};
}
export async function createGoogleEvent(db:Database,owner:string,env:Runtime,id:string,action:GoogleEventAction,overlapConfirmation?:string){
 const token=await accessToken(db,owner,'google_calendar',env),eventId='orbit'+id.replaceAll('-',''),base='https://www.googleapis.com/calendar/v3/calendars/primary/events';
 const existing=await fetchJson(base+'/'+eventId,{headers:{Authorization:`Bearer ${token}`}});
 if(existing.response.ok){if(existing.data.extendedProperties?.private?.orbitAction!==id)throw new AgentError('일정 번호가 충돌했습니다. 새 제안을 생성해 주세요.','CONFLICT',409);return {url:existing.data.htmlLink as string|undefined}}
 if(existing.response.status!==404)throw new AgentError('이전 일정 생성 결과를 확인하지 못했습니다. 다시 시도해 주세요.','CALENDAR',502);
 const event=action.event;
 const current=await readWorkspace(db,owner);if(event.timeZone!==current.data.preferences.timeZone)throw new AgentError('워크스페이스 시간대가 달라졌습니다. 새 일정 제안을 요청해 주세요.','CONFLICT',409);if(event.date<todayInZone(event.timeZone))throw new AgentError('지난 일정은 생성할 수 없습니다.');
 const live=normalizeEvents(await googleEvents(db,owner,env,event.date,addDays(event.date,1),event.timeZone),event.timeZone,event.date,addDays(event.date,1));
 // Cached Google rows may be stale or duplicate live events; only live Google data
 // and locally managed Orbit events participate in this explicit acknowledgement.
 const conflicts=[...current.data.events.filter(e=>!e.id.startsWith('google:')&&e.date===event.date),...live].filter(e=>overlaps(e,event)).map(({id,title,date,start,end})=>({id,title,date,start,end})).sort((a,b)=>a.id.localeCompare(b.id));
 if(conflicts.length){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({owner,id,event,conflicts})));
  const confirmation=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(overlapConfirmation!==confirmation)throw new AgentError('같은 시간에 일정이 있습니다. 아래 내용을 확인한 뒤 겹치는 시간에 등록하거나 다른 시간을 요청해 주세요.','CALENDAR_OVERLAP',409,{overlapConfirmation:confirmation,conflicts:conflicts.slice(0,20).map(({title,date,start,end})=>({title,date,start,end})),total:conflicts.length});
 }

 const payload={id:eventId,summary:event.title,description:event.description,start:{dateTime:zonedInstant(event.date,event.start,event.timeZone),timeZone:event.timeZone},end:{dateTime:zonedInstant(event.date,event.end,event.timeZone),timeZone:event.timeZone},extendedProperties:{private:{orbitAction:id}},reminders:{useDefault:false}};
 const {response,data}=await fetchJson(base+'?sendUpdates=none',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok)throw new AgentError('일정 생성 결과를 확인하지 못했습니다. 같은 제안에서 다시 시도해 주세요.','CALENDAR',502);return {url:data.htmlLink as string|undefined};
}
