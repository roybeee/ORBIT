import {categoryOf,googleItemColor} from './calendar-categories.ts';
import type {CalendarEvent,Preferences} from './model.ts';
import type {Database,SqlValue} from '../../db/repository.ts';
export interface GoogleColorTarget {calendarId:string;eventId:string;colorId:string}
export const googleColorKey=(target:Pick<GoogleColorTarget,'calendarId'|'eventId'>)=>'google-color:'+JSON.stringify([target.calendarId,target.eventId]);
// A multi-day event has several display rows but just one Google resource.
export function googleColorTargets(events:CalendarEvent[],preferences:Preferences,previous?:Preferences){
 const targets=new Map<string,GoogleColorTarget>();
 for(const event of [...events].sort((a,b)=>Number(Object.hasOwn(preferences.eventColors??{},a.id))-Number(Object.hasOwn(preferences.eventColors??{},b.id)))){
  if(!event.google||event.google.orbitEventId&&events.some(e=>e.id===event.google!.orbitEventId))continue;
  const category=preferences.eventCategories?.[event.id]??categoryOf(event);
  const explicit=Object.hasOwn(preferences.eventColors??{},event.id)||Object.hasOwn(preferences.eventCategories??{},event.id)||Object.hasOwn(preferences.categoryColors??{},category);
  const colorId=googleItemColor(event,preferences);
  const changed=previous&&(googleItemColor(event,previous)!==colorId||previous.eventColors?.[event.id]!==preferences.eventColors?.[event.id]||previous.eventCategories?.[event.id]!==preferences.eventCategories?.[event.id]);
  if(previous?!changed:!explicit)continue;
  const target={calendarId:event.google.calendarId,eventId:event.google.eventId,colorId};targets.set(googleColorKey(target),target);
 }
 return [...targets.values()];
}
export function googleColorQueue(db:Database,owner:string,targets:GoogleColorTarget[],gate:string,values:SqlValue[],timestamp:string){
 const rows=targets.map(target=>({eventId:googleColorKey(target),googleColor:target,sourceKey:target.colorId,automatic:true,status:'pending',fingerprint:'',leaseUntil:0,queuedAt:timestamp,message:'Google 색상 반영 대기'}));
 return db.prepare(`INSERT INTO orbit_calendar_exports(owner_id,event_id,state_json)
 SELECT ?,json_extract(value,'$.eventId'),value FROM json_each(?) WHERE ${gate}
 ON CONFLICT(owner_id,event_id) DO UPDATE SET state_json=json_set(orbit_calendar_exports.state_json,'$.status','pending','$.googleColor',json_extract(excluded.state_json,'$.googleColor'),'$.sourceKey',json_extract(excluded.state_json,'$.sourceKey'),'$.leaseUntil',0,'$.queuedAt',json_extract(excluded.state_json,'$.queuedAt'),'$.message','Google 색상 반영 대기')
 WHERE COALESCE(json_extract(orbit_calendar_exports.state_json,'$.sourceKey'),'')<>json_extract(excluded.state_json,'$.sourceKey') AND COALESCE(json_extract(orbit_calendar_exports.state_json,'$.leaseUntil'),0)<=?`)
 .bind(owner,JSON.stringify(rows),...values,Date.now());
}

// Appearance belongs to a Google occurrence, including every visible day of it.
// A cached mirror uses the local original's outbox instead of competing writes.
export function alignGoogleAppearance(events:CalendarEvent[],previous:Preferences,next:Preferences){
 if(next.eventColors)next.eventColors={...next.eventColors};
 if(next.eventCategories)next.eventCategories={...next.eventCategories};
 for(const field of ['eventColors','eventCategories'] as const){
  const changes=events.filter(e=>e.google&&previous[field]?.[e.id]!==next[field]?.[e.id]);
  for(const event of changes){
   const value=next[field]?.[event.id];
   for(const peer of events.filter(e=>e.google?.calendarId===event.google!.calendarId&&e.google?.eventId===event.google!.eventId||e.id===event.google!.orbitEventId)){
    const map=next[field]??={};
    if(value===undefined)delete map[peer.id];else (map as Record<string,unknown>)[peer.id]=value;
   }
  }
 }
}
