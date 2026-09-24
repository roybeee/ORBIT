import {readWorkspace,writeCommand,RevisionConflict,type Database} from '../../../db/repository.ts';
import {DomainError} from '../reducer.ts';
import {eventScope} from '../event-details.ts';
import type {CalendarEvent} from '../model.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {normalizeEvents,zonedInstant,type GoogleEvent} from './calendar.ts';
import {signature,detailsSignature,type CalendarDelivery} from './calendar-outbox.ts';

// Two-way sync for events ORBIT created in Google. After each calendar read, an event whose
// delivery is settled (verified) follows what the user did in Google: an edit is taken over,
// a deletion deletes it in ORBIT. Events with a pending ORBIT change are left to the outbox.
const REMOTE_CHECKS=5;
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
// The outbox writes this text when an ORBIT event has no memo; it is not a user's memo.
const PLACEHOLDER='Orbit에서 등록한 일정';
const memo=(event:CalendarEvent)=>event.description===PLACEHOLDER?'':event.description??'';
// What adoption would change. A task's block keeps the task's title and memo, so only its time counts.
function adopted(mine:CalendarEvent,theirs:CalendarEvent):CalendarEvent{
 const time={date:theirs.date,start:theirs.start,end:theirs.end};
 return mine.taskId?{...mine,...time}:{...mine,...time,title:theirs.title,description:memo(theirs)||undefined};
}
const same=(a:CalendarEvent,b:CalendarEvent)=>a.title===b.title&&a.date===b.date&&a.start===b.start&&a.end===b.end&&(a.description??'')===(b.description??'');

async function connectedAccount(db:Database,owner:string,env:Runtime){
 const token=await accessToken(db,owner,'google_calendar',env);
 const {response,data}=await fetchJson<{id?:string}>('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',{headers:{Authorization:`Bearer ${token}`}},6000);
 return response.ok&&typeof data.id==='string'?data.id:'';
}
// Looks up one ORBIT-created event directly, for when it left the synced window.
async function remoteCopy(db:Database,owner:string,env:Runtime,state:CalendarDelivery,timeZone:string):Promise<CalendarEvent|null|undefined>{
 const token=await accessToken(db,owner,'google_calendar',env),googleId='orbit'+await digest(owner+'\0'+state.eventId);
 const {response,data}=await fetchJson<GoogleEvent>('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(state.calendarId!)+'/events/'+googleId,{headers:{Authorization:`Bearer ${token}`}},6000);
 if(response.status===404||response.status===410||(response.ok&&data.status==='cancelled'))return null;
 if(!response.ok||data.extendedProperties?.private?.orbitEventId!==state.eventId)return undefined;
 const copies=normalizeEvents([data],timeZone,'1970-01-01','2100-01-01');
 return copies.length===1?copies[0]:undefined;
}

async function adopt(db:Database,owner:string,mine:CalendarEvent,theirs:CalendarEvent,next:CalendarEvent,row:{state_json:string},timeZone:string){
 const range={start:{dateTime:zonedInstant(theirs.date,theirs.start,timeZone)},end:{dateTime:zonedInstant(theirs.date,theirs.end,timeZone)}};
 const lastSignature=signature({summary:theirs.title,...range});
 const lastDetails=detailsSignature({description:theirs.description,extendedProperties:{private:{orbitScope:eventScope(mine)}}});
 const snapshot=await readWorkspace(db,owner);
 // The delivery receipt must be unchanged at commit, so a concurrent ORBIT edit wins.
 await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:snapshot.revision,action:{type:'calendar.adopt',event:next}},new Date(),
  {gate:'EXISTS(SELECT 1 FROM orbit_calendar_exports WHERE owner_id=? AND event_id=? AND state_json=?)',values:[owner,mine.id,row.state_json],
   statements:(gate,values)=>[db.prepare(`UPDATE orbit_calendar_exports SET state_json=json_set(state_json,'$.lastSignature',?,'$.lastDetails',?) WHERE owner_id=? AND event_id=? AND ${gate}`).bind(lastSignature,lastDetails,owner,mine.id,...values)]});
}

export async function reconcileOrbitEvents(db:Database,owner:string,env:Runtime,window:{from:string;to:string;targets:string[]}){
 const snapshot=await readWorkspace(db,owner),timeZone=snapshot.data.preferences.timeZone;
 const cache=await db.prepare('SELECT events_json FROM orbit_calendar_cache WHERE owner_id=?').bind(owner).first<{events_json:string}>();
 const copies=cache?JSON.parse(cache.events_json) as CalendarEvent[]:[];
 const {results}=await db.prepare("SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND json_extract(state_json,'$.automatic')=1 AND json_extract(state_json,'$.status')='verified'").bind(owner).all<{state_json:string}>();
 const mine=snapshot.data.events.filter(e=>!e.id.startsWith('google:')&&!e.id.startsWith('approved:'));
 let checks=0,account:string|undefined;
 for(const row of results){
  const state=JSON.parse(row.state_json) as CalendarDelivery,event=mine.find(e=>e.id===state.eventId);
  if(!event||!state.calendarId)continue;
  const found=copies.filter(e=>e.google?.orbitEventId===event.id);
  let theirs:CalendarEvent|null|undefined=found.length===1?found[0]:undefined;
  if(!found.length){
   const watched=window.targets.includes('primary')||window.targets.includes(state.calendarId);
   if(!watched||event.date<window.from||event.date>=window.to||checks>=REMOTE_CHECKS)continue;
   // A 404 only means "deleted" in the account that received the event; after reconnecting
   // another account every lookup would 404, so nothing is looked up then.
   account??=await connectedAccount(db,owner,env);
   if(account!==state.calendarId)continue;
   checks++;theirs=await remoteCopy(db,owner,env,state,timeZone);
  }
  try{
   if(theirs===null){const latest=await readWorkspace(db,owner);await writeCommand(db,owner,{operationId:crypto.randomUUID(),expectedRevision:latest.revision,action:{type:'event.delete',id:event.id}});}
   // ORBIT events have no all-day form; one turned all-day in Google stays as it was here.
   else if(theirs&&!theirs.allDay){const next=adopted(event,theirs);if(!same(event,next))await adopt(db,owner,event,theirs,next,row,timeZone)}
  }catch(error){if(!(error instanceof RevisionConflict||error instanceof DomainError))throw error}
 }
}
