import {readWorkspace,type Database} from '../../../db/repository.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {zonedInstant} from './calendar.ts';
import {AgentError} from './errors.ts';

export interface CalendarDelivery {
 eventId:string;automatic:true;status:'pending'|'publishing'|'verified'|'uncertain'|'cancelled';
 fingerprint:string;leaseUntil:number;queuedAt:string;message?:string;
 calendarId?:string;url?:string;verifiedAt?:string;lastSignature?:string;attemptedSignatures?:string[];
}
const digest=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const signature=(event:{summary?:string;start?:{dateTime?:string};end?:{dateTime?:string}})=>
 JSON.stringify([event.summary??'',Date.parse(event.start?.dateTime??''),Date.parse(event.end?.dateTime??'')]);

export async function calendarDeliveryStatus(db:Database,owner:string){
 const {results}=await db.prepare("SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND json_extract(state_json,'$.automatic')=1").bind(owner).all<{state_json:string}>();
 const rows=results.map(r=>JSON.parse(r.state_json) as CalendarDelivery);
 return {pending:rows.filter(r=>['pending','publishing'].includes(r.status)).length,
  failed:rows.filter(r=>r.status==='uncertain').length,
  verified:rows.filter(r=>r.status==='verified').length,
  message:rows.find(r=>r.status==='uncertain')?.message};
}

// One bounded delivery at a time; receipts persist across disconnects and app restarts.
export async function flushCalendarOutbox(db:Database,owner:string,env:Runtime,eventId?:string){
 const row=await db.prepare("SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND json_extract(state_json,'$.automatic')=1 AND (json_extract(state_json,'$.status') IN ('pending','uncertain','publishing') OR (?<>'' AND json_extract(state_json,'$.status')='verified')) AND COALESCE(json_extract(state_json,'$.leaseUntil'),0)<=? AND (?='' OR event_id=?) ORDER BY COALESCE(json_extract(state_json,'$.attemptedAt'),'') LIMIT 1")
  .bind(owner,eventId??'',Date.now(),eventId??'',eventId??'').first<{state_json:string}>();
 if(!row)return calendarDeliveryStatus(db,owner);
 const state=JSON.parse(row.state_json) as CalendarDelivery;
 const snapshot=await readWorkspace(db,owner);
 const event=snapshot.data.events.find(e=>e.id===state.eventId&&!e.id.startsWith('google:'));
 if(!event){await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?')
   .bind(JSON.stringify({...state,status:'cancelled',leaseUntil:0,message:'Orbit에서 삭제되어 등록을 중단했습니다.'}),owner,state.eventId,row.state_json).run();return calendarDeliveryStatus(db,owner);}
 state.status='publishing';state.leaseUntil=Date.now()+60000;
 let lease=JSON.stringify(state);
 const claim=await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=?)')
  .bind(lease,owner,state.eventId,row.state_json,owner,snapshot.revision).run();
 if(claim.meta?.changes!==1)return calendarDeliveryStatus(db,owner);
 try{
  const token=await accessToken(db,owner,'google_calendar',env);
  const headers={Authorization:`Bearer ${token}`};
  // Bind receipts to the actual Google calendar, so reconnecting another account
  // cannot silently copy an already attempted event into that account.
  const calendar=await fetchJson('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary',{headers},6000);
  if(!calendar.response.ok||typeof calendar.data.id!=='string')throw new AgentError('Google 계정 확인이 필요합니다. 연결 관리에서 다시 연결해 주세요.','RECONNECT',409);
  if(state.calendarId&&state.calendarId!==calendar.data.id)throw new AgentError('이 일정을 등록한 Google 계정과 다릅니다. 원래 계정을 다시 연결해 주세요.','CONFLICT',409);
  state.calendarId=calendar.data.id;
  const actionId=await digest(owner+'\0'+state.eventId),googleId='orbit'+actionId;
  const base='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(state.calendarId!)+'/events';
  const payload={summary:event.title,start:{dateTime:zonedInstant(event.date,event.start,snapshot.data.preferences.timeZone),timeZone:snapshot.data.preferences.timeZone},
   end:{dateTime:zonedInstant(event.date,event.end,snapshot.data.preferences.timeZone),timeZone:snapshot.data.preferences.timeZone}};
  state.fingerprint=await digest(signature(payload));
  const previousSignatures=[state.lastSignature,...(state.attemptedSignatures??[])];
  // Persist the target before the first remote mutation, including lost ACKs.
  const bound=JSON.stringify(state);
  const boundResult=await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(bound,owner,state.eventId,lease).run();
  if(boundResult.meta?.changes!==1)throw new AgentError('일정이 변경되었습니다. 다시 확인해 주세요.','CONFLICT',409);
  lease=bound;
  const beforeMutation=async()=>{
   if(state.leaseUntil<Date.now()+6500)throw new AgentError('전송 시간이 지나 자동으로 다시 확인합니다.','BUSY',409);
   state.attemptedSignatures=[...new Set([signature(payload),...(state.attemptedSignatures??[])])].slice(0,3);
   const next=JSON.stringify(state);
   const result=await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(next,owner,state.eventId,lease).run();
   if(result.meta?.changes!==1)throw new AgentError('일정이 변경되었습니다. 다시 확인해 주세요.','CONFLICT',409);
   lease=next;
  };
  const current=await fetchJson(base+'/'+googleId,{headers},6000);
  let remote=current.data;
  if(current.response.ok){
   if(remote.extendedProperties?.private?.orbitAction!==actionId||remote.extendedProperties?.private?.orbitEventId!==state.eventId)
    throw new AgentError('Google 일정의 연결 정보를 확인할 수 없습니다.','CONFLICT',409);
   if(remote.status==='cancelled')throw new AgentError('Google에서 삭제된 일정입니다. 새 일정으로 등록해 주세요.','CONFLICT',409);
   if(signature(remote)!==signature(payload)){
    if(!previousSignatures.includes(signature(remote))||!remote.etag)
     throw new AgentError('Google에서 일정이 변경되었습니다. 양쪽 내용을 확인한 뒤 조정해 주세요.','CONFLICT',409);
    await beforeMutation();
    const patched=await fetchJson(base+'/'+googleId+'?sendUpdates=none',{method:'PATCH',headers:{...headers,'Content-Type':'application/json','If-Match':remote.etag},body:JSON.stringify(payload)},6000);
    if(!patched.response.ok)throw new AgentError(patched.response.status===412?'Google 일정이 변경되어 덮어쓰지 않았습니다.':'Google 수정 반영을 확인하지 못했습니다. 자동으로 다시 확인합니다.','CALENDAR',502);
    remote=patched.data;
   }
  }else if(current.response.status===404){
   if(state.verifiedAt)throw new AgentError('Google에서 기존 일정을 찾을 수 없습니다. 새 일정으로 등록해 주세요.','CONFLICT',409);
   await beforeMutation();
   const created=await fetchJson(base+'?sendUpdates=none',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({...payload,id:googleId,description:'Orbit에서 등록한 일정',extendedProperties:{private:{orbitAction:actionId,orbitEventId:state.eventId}},reminders:{useDefault:true}})},6000);
   if(!created.response.ok)throw new AgentError('Google 등록 결과를 확인하지 못했습니다. 중복 없이 다시 확인합니다.','CALENDAR',502);
   remote=created.data;
  }else throw new AgentError(current.response.status===410?'Google에서 삭제된 일정입니다. 새 일정으로 등록해 주세요.':'Google 일정 확인에 실패했습니다. 연결 상태를 확인해 주세요.','CALENDAR',502);
  if(signature(remote)!==signature(payload))throw new AgentError('Google 응답을 확인하지 못했습니다. 자동으로 다시 확인합니다.','CALENDAR',502);
  state.status='verified';state.lastSignature=signature(payload);state.verifiedAt=new Date().toISOString();
  state.url=typeof remote.htmlLink==='string'?remote.htmlLink:state.url;
  state.message='Google 기본 캘린더에 등록됨';
 }catch(error){state.status='uncertain';state.message=error instanceof AgentError?error.message:'Google 응답을 확인하지 못했습니다. 자동으로 다시 확인합니다.';}
 finally{
  state.leaseUntil=0;
  await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?')
   .bind(JSON.stringify({...state,attemptedAt:new Date().toISOString()}),owner,state.eventId,lease).run();
 }
 return calendarDeliveryStatus(db,owner);
}
