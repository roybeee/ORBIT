import {prepareWorkspace} from '../../../db/workspace-storage.ts';
import {storedEventScope} from '../event-details.ts';
import {flushCalendarOutbox,calendarDeliveryStatus} from './calendar-outbox.ts';
import {calendarSelection} from './calendar-settings.ts';
import {reconcileOrbitEvents} from './calendar-reconcile.ts';
import {syncGoogleTasks} from './google-tasks.ts';
import {recordSource} from '../source-status.ts';
import {readWorkspace,RevisionConflict,queueTaskCalendarBackfill,queueGoogleColorBackfill,type Database} from '../../../db/repository.ts';
import {addDays,todayInZone,validDate} from '../dates.ts';
import type {CalendarEvent} from '../model.ts';
import {overlaps} from '../planner.ts';
import {accessToken,connections,fetchJson,type Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';
import type {GoogleEventAction} from './types.ts';
export interface GoogleEvent {orbitCalendarId?:string;id:string;summary?:string;description?:string;status?:string;transparency?:string;attendees?:{self?:boolean;responseStatus?:string}[];start:{date?:string;dateTime?:string};end:{date?:string;dateTime?:string};htmlLink?:string;extendedProperties?:{private?:Record<string,string>};etag?:string;recurrence?:string[];recurringEventId?:string;colorId?:string;iCalUID?:string}
export interface GoogleCalendarEntry {id:string;accessRole:string;primary?:boolean;deleted?:boolean;summary?:string;summaryOverride?:string}
const parts=(time:Date,timeZone:string)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
export function zonedInstant(date:string,minute:number,timeZone:string){const target=Date.parse(`${date}T00:00:00Z`)+minute*60000;let utc=target;for(let i=0;i<4;i++){const p=parts(new Date(utc),timeZone),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);if(local===target)return new Date(utc).toISOString();utc+=target-local}throw new AgentError('해당 시간대에서 존재하지 않는 시각입니다. 시간을 조정해 주세요.');}
export function normalizeEvents(items:GoogleEvent[],timeZone:string,from:string,to:string):CalendarEvent[]{
 const out:CalendarEvent[]=[];
 for(const event of items){if(!event.id||event.status==='cancelled'||event.transparency==='transparent'||event.attendees?.some(a=>a.self&&a.responseStatus==='declined'))continue;
  let first:string,last:string,start=0,end=1440;
  if(event.start.date&&event.end.date){first=event.start.date;last=addDays(event.end.date,-1)}else{const a=new Date(event.start.dateTime??''),b=new Date(event.end.dateTime??'');if(!Number.isFinite(+a)||!Number.isFinite(+b)||+b<=+a)continue;const p=parts(a,timeZone),q=parts(new Date(Math.ceil(+b/60000)*60000),timeZone);first=`${p.year}-${p.month}-${p.day}`;last=`${q.year}-${q.month}-${q.day}`;start=Number(p.hour)*60+Number(p.minute);end=Number(q.hour)*60+Number(q.minute);if(end===0){last=addDays(last,-1);end=1440}}
  if(!validDate(first)||!validDate(last))continue;
  for(let date=first<from?from:first;date<=last&&date<to;date=addDays(date,1)){const a=date===first?start:0,b=date===last?end:1440;if(b>a)out.push({id:`google:${event.orbitCalendarId&&event.orbitCalendarId!=='primary'?encodeURIComponent(event.orbitCalendarId)+':':''}${event.id}:${date}`,google:{calendarId:event.orbitCalendarId??'primary',eventId:event.id,orbitEventId:event.extendedProperties?.private?.orbitEventId},title:(event.summary??'비공개 일정').slice(0,160),...(event.description!==undefined?{description:event.description}:{}),...(storedEventScope(event.extendedProperties?.private?.orbitScope)?{scope:storedEventScope(event.extendedProperties?.private?.orbitScope)}:{}),date,start:a,end:b,kind:'meeting',...(event.start.date&&event.end.date?{allDay:true}:{})});}
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id));
}
export async function googleEvents(db:Database,owner:string,env:Runtime,from:string,to:string,timeZone:string,calendarIds?:string[]){
 const deadline=Date.now()+55000;const ids=calendarIds??(await calendarSelection(db,owner)).ids,token=await accessToken(db,owner,'google_calendar',env),items:GoogleEvent[]=[];
 for(const calendarId of ids){let page='';for(let n=0;n<10;n++){
 const url=new URL('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(calendarId)+'/events');url.search=new URLSearchParams({timeMin:zonedInstant(from,0,timeZone),timeMax:zonedInstant(to,0,timeZone),timeZone,singleEvents:'true',showDeleted:'false',maxResults:'250',...(page?{pageToken:page}:{})}).toString();
 if(Date.now()>=deadline)throw new AgentError('일정 조회 시간이 초과되어 기존 일정을 유지합니다.','CALENDAR',504);const {response,data}=await fetchJson<{items?:GoogleEvent[];nextPageToken?:string}>(url.href,{headers:{Authorization:`Bearer ${token}`}},Math.max(1000,Math.min(15000,deadline-Date.now())));if(!response.ok)throw new AgentError('선택한 Google 캘린더를 모두 확인하지 못했습니다. 기존 일정을 유지합니다.','CALENDAR',502);
 items.push(...(data.items??[]).map((e:GoogleEvent)=>({...e,orbitCalendarId:calendarId})));page=data.nextPageToken??'';if(!page)break;if(n===9)throw new AgentError('일정 조회 범위를 모두 읽지 못했습니다.','CALENDAR',422);
 }}return items;
}
async function syncCalendarInternal(db:Database,owner:string,env:Runtime,date?:string){
 if(!(await connections(db,owner,env)).find(c=>c.provider==='google_calendar')?.connected){if(await db.prepare('SELECT owner_id FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first())throw new AgentError('Google Calendar를 다시 연결해 최신 일정을 확인해 주세요.','RECONNECT',409);return {connected:false,count:0};}
 const selection=await calendarSelection(db,owner);
 const snapshot=await readWorkspace(db,owner),timeZone=snapshot.data.preferences.timeZone,day=date??todayInZone(timeZone),from=addDays(day,-7),to=addDays(day,31);
 const events=normalizeEvents(await googleEvents(db,owner,env,from,to,timeZone,selection.ids),timeZone,from,to);const serialized=JSON.stringify(events);if(new TextEncoder().encode(serialized).length>700000)throw new AgentError('일정의 크기가 너무 큽니다.','CALENDAR',422);
 if((await calendarSelection(db,owner)).version!==selection.version)throw new RevisionConflict('캘린더 선택이 변경되었습니다. 다시 동기화해 주세요.');
 const previous=await db.prepare('SELECT events_json,time_zone FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first<{events_json:string;time_zone:string}>();const now=new Date().toISOString();
 if(previous?.events_json===serialized&&previous.time_zone===timeZone){const updated=await db.prepare("UPDATE orbit_calendar_cache SET updated_at=?,range_start=?,range_end=? WHERE owner_id=? AND COALESCE((SELECT updated_at FROM orbit_calendar_settings WHERE owner_id=?),'')=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=?)").bind(now,from,to,owner,owner,selection.version,owner,snapshot.revision).run();if(updated.meta?.changes!==1)throw new RevisionConflict('조회 중 캘린더 설정이나 기록이 변경되었습니다.');return {connected:true,count:events.length,updatedAt:now,targets:selection.ids,from,to,selectionVersion:selection.version}}
 const data={...snapshot.data,events:snapshot.data.events.filter(e=>!e.id.startsWith('google:'))},id=crypto.randomUUID(),revision=snapshot.revision+1,storage=prepareWorkspace(data);
 const result=await db.batch([
  db.prepare("INSERT INTO orbit_workspaces(owner_id,revision,state_json,mutation_id,updated_at) SELECT ?,?,?,?,? WHERE COALESCE((SELECT updated_at FROM orbit_calendar_settings WHERE owner_id=?),'')=? ON CONFLICT(owner_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,mutation_id=excluded.mutation_id,updated_at=excluded.updated_at WHERE orbit_workspaces.revision=? AND COALESCE((SELECT updated_at FROM orbit_calendar_settings WHERE owner_id=?),'')=?").bind(owner,revision,storage.stateJson,id,now,owner,selection.version,snapshot.revision,owner,selection.version),
  ...storage.statements(db,owner,'EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?)',[owner,revision,id]),
  db.prepare('INSERT INTO orbit_calendar_cache(owner_id,events_json,time_zone,range_start,range_end,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=? AND mutation_id=?) ON CONFLICT(owner_id) DO UPDATE SET events_json=excluded.events_json,time_zone=excluded.time_zone,range_start=excluded.range_start,range_end=excluded.range_end,updated_at=excluded.updated_at').bind(owner,serialized,timeZone,from,to,now,owner,revision,id),
 ]);if(result[0].meta?.changes!==1)throw new RevisionConflict('일정을 확인하는 동안 업무가 변경됐습니다. 다시 동기화해 주세요.');return {connected:true,count:events.length,updatedAt:now,targets:selection.ids,from,to,selectionVersion:selection.version};
}
export async function createGoogleEvent(db:Database,owner:string,env:Runtime,id:string,action:GoogleEventAction,overlapConfirmation?:string,options?:{internalEventId:string;leaseState?:string}){
 const token=await accessToken(db,owner,'google_calendar',env),eventId='orbit'+id.replaceAll('-',''),base='https://www.googleapis.com/calendar/v3/calendars/primary/events';
 const existing=await fetchJson<GoogleEvent>(base+'/'+eventId,{headers:{Authorization:`Bearer ${token}`}});
 if(existing.response.ok){if(existing.data.extendedProperties?.private?.orbitAction!==id)throw new AgentError('일정 번호가 충돌했습니다. 새 제안을 생성해 주세요.','CONFLICT',409);if(options){const actual=normalizeEvents([existing.data as GoogleEvent],action.event.timeZone,action.event.date,addDays(action.event.date,1));if(existing.data.status==='cancelled'||actual.length!==1||actual[0].start!==action.event.start||actual[0].end!==action.event.end||existing.data.summary!==action.event.title)throw new AgentError('Google 일정이 변경되었거나 삭제되었습니다. Google에서 확인해 주세요.','CONFLICT',409);}return {url:existing.data.htmlLink as string|undefined}}
 if(existing.response.status!==404)throw new AgentError('이전 일정 생성 결과를 확인하지 못했습니다. 다시 시도해 주세요.','CALENDAR',502);
 const event=action.event;
 const current=await readWorkspace(db,owner);if(event.timeZone!==current.data.preferences.timeZone)throw new AgentError('워크스페이스 시간대가 달라졌습니다. 새 일정 제안을 요청해 주세요.','CONFLICT',409);if(event.date<todayInZone(event.timeZone))throw new AgentError('지난 일정은 생성할 수 없습니다.');
 const live=normalizeEvents(await googleEvents(db,owner,env,event.date,addDays(event.date,1),event.timeZone,[...new Set([...(await calendarSelection(db,owner)).ids,'primary'])]),event.timeZone,event.date,addDays(event.date,1));
 // Cached Google rows may be stale or duplicate live events; only live Google data
 // and locally managed Orbit events participate in this explicit acknowledgement.
 const conflicts=[...current.data.events.filter(e=>!e.id.startsWith('google:')&&e.id!==options?.internalEventId&&e.date===event.date),...live].filter(e=>overlaps(e,event)).map(({id,title,date,start,end})=>({id,title,date,start,end})).sort((a,b)=>a.id.localeCompare(b.id));
 if(conflicts.length){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({owner,id,event,conflicts})));
  const confirmation=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(overlapConfirmation!==confirmation)throw new AgentError('같은 시간에 일정이 있습니다. 아래 내용을 확인한 뒤 겹치는 시간에 등록하거나 다른 시간을 요청해 주세요.','CALENDAR_OVERLAP',409,{overlapConfirmation:confirmation,conflicts:conflicts.slice(0,20).map(({title,date,start,end})=>({title,date,start,end})),total:conflicts.length});
 }

 if(options){const latest=await readWorkspace(db,owner),block=latest.data.events.find(e=>e.id===options.internalEventId);const approved=latest.data.proposals.flatMap(p=>p.items).some(i=>'approved:'+i.id===options.internalEventId&&i.state==='approved');if(!approved||!block||block.title!==event.title||block.date!==event.date||block.start!==event.start||block.end!==event.end||latest.data.preferences.timeZone!==event.timeZone)throw new AgentError('집중 시간 승인이 변경되어 등록하지 않았습니다.','CONFLICT',409);if(options.leaseState){const receipt=await db.prepare('SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND event_id=?').bind(owner,options.internalEventId).first<{state_json:string}>();if(receipt?.state_json!==options.leaseState||JSON.parse(receipt.state_json).leaseUntil<Date.now()+25000)throw new AgentError('등록 시간이 초과되어 같은 버튼으로 확인이 필요합니다.','BUSY',409);}}
 const payload={id:eventId,summary:event.title,description:event.description,start:{dateTime:zonedInstant(event.date,event.start,event.timeZone),timeZone:event.timeZone},end:{dateTime:zonedInstant(event.date,event.end,event.timeZone),timeZone:event.timeZone},extendedProperties:{private:{orbitAction:id,...(options?{orbitEventId:options.internalEventId}:{})}},reminders:{useDefault:false}};
 const {response,data}=await fetchJson<GoogleEvent>(base+'?sendUpdates=none',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!response.ok)throw new AgentError('일정 생성 결과를 확인하지 못했습니다. 같은 제안에서 다시 시도해 주세요.','CALENDAR',502);return {url:data.htmlLink as string|undefined};
}

export async function syncCalendar(db:Database,owner:string,env:Runtime,date?:string){
 try{const initial=await readWorkspace(db,owner);await queueTaskCalendarBackfill(db,owner,date??todayInZone(initial.data.preferences.timeZone));await flushCalendarOutbox(db,owner,env);const result=await syncCalendarInternal(db,owner,env,date);
 // Best effort: the read itself succeeded, so a reconcile failure must not fail the sync.
 if(result.connected&&result.from&&result.to)await reconcileOrbitEvents(db,owner,env,{from:result.from,to:result.to,targets:result.targets??[]}).catch(()=>undefined);
 if(result.connected)await syncGoogleTasks(db,owner,env).catch(()=>undefined);
 if(result.connected&&(await calendarSelection(db,owner)).version!==result.selectionVersion)throw new RevisionConflict('캘린더 선택이 변경되어 최신 확인이 필요합니다.');
 await recordSource(db,owner,'google_calendar',{state:result.connected?'ok':'partial',detail:result.connected?'선택한 캘린더 조회 완료':'Google Calendar 연결 필요',count:result.count,from:result.from,to:result.to,targets:result.targets},result.selectionVersion);if(result.connected)await queueGoogleColorBackfill(db,owner);return {...result,delivery:await calendarDeliveryStatus(db,owner)};}
 catch(error){await recordSource(db,owner,'google_calendar',{state:'error',detail:error instanceof Error?error.message:'일정 동기화 실패'});throw error;}
}
