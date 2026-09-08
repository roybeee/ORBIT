import type {Database} from '../../../db/repository.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';
import type {GoogleSeriesDeleteAction} from './types.ts';

const base='https://www.googleapis.com/calendar/v3';
const path=(calendarId:string,eventId:string)=>`${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
const reconnect=()=>new AgentError('Orbit의 연결 → Google Calendar에서 다시 연결하고 일정 보기·수정 권한을 승인해 주세요. Hermes 재인증은 필요하지 않습니다.','RECONNECT',409);
function check(response:Response){
 if(response.status===401||response.status===403)throw reconnect();
 if(response.status===412)throw new AgentError('확인 이후 일정이 변경되어 삭제하지 않았습니다. 최신 대상으로 다시 제안받아 주세요.','CONFLICT',409);
 if(!response.ok)throw new AgentError('Google Calendar 대상이나 응답을 확인하지 못했습니다. 삭제 결과를 확정할 수 없습니다.','CALENDAR',502);
}
async function calendar(token:string){
 const r=await fetchJson(base+'/users/me/calendarList/primary',{headers:{Authorization:`Bearer ${token}`}});check(r.response);
 if(typeof r.data.id!=='string'||!['owner','writer'].includes(r.data.accessRole))throw reconnect();
 return r.data.id as string;
}
async function get(token:string,calendarId:string,eventId:string){return fetchJson(path(calendarId,eventId),{headers:{Authorization:`Bearer ${token}`}});}
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,1024}$/.test(id);
function master(event:Record<string,any>,title:string){
 if(!validId(event.id)||event.status==='cancelled'||event.recurringEventId||!Array.isArray(event.recurrence)||!event.recurrence.length||event.summary!==title||typeof event.etag!=='string'||typeof event.iCalUID!=='string')throw new AgentError('제목과 반복 시리즈를 확실히 확인하지 못해 삭제하지 않았습니다. 대상 일정의 정확한 제목과 ID를 확인해 주세요.','CALENDAR_TARGET',409);
}
// Owner Google credentials stay on Orbit's server, never in Hermes context or logs.
export async function inspectCalendarSeries(db:Database,owner:string,env:Runtime,eventId:string){
 if(!validId(eventId))throw new AgentError('Google 일정 ID를 확인해 주세요.');
 const token=await accessToken(db,owner,'google_calendar',env),calendarId=await calendar(token),target=await get(token,calendarId,eventId);check(target.response);
 if(target.data.id!==eventId||target.data.status==='cancelled')throw new AgentError('활성 대상 일정을 확인하지 못했습니다.','CALENDAR_TARGET',409);
 const seriesId=target.data.recurringEventId??eventId;if(!validId(seriesId))throw new AgentError('반복 시리즈 ID가 불명확합니다.','CALENDAR_TARGET',409);
 const series=seriesId===eventId?target:await get(token,calendarId,seriesId);check(series.response);
 master(series.data,target.data.summary);
 if(series.data.id!==seriesId)throw new AgentError('반복 시리즈가 일치하지 않습니다.','CALENDAR_TARGET',409);
 return {calendarId,seriesId,etag:series.data.etag as string,iCalUID:series.data.iCalUID as string,title:series.data.summary as string};
}
export async function prepareSeriesDeletion(db:Database,owner:string,env:Runtime,action:GoogleSeriesDeleteAction){
 const verified=await inspectCalendarSeries(db,owner,env,action.eventId);
 if(verified.title!==action.expectedTitle)throw new AgentError('요청한 제목과 Google 일정의 실제 제목이 달라 삭제하지 않았습니다.','CALENDAR_TARGET',409);
 return {...action,verified};
}

export async function deleteCalendarSeries(db:Database,owner:string,env:Runtime,id:string,lease:string,action:GoogleSeriesDeleteAction){
 const v=action.verified;if(!v||action.scope!=='all'||v.title!==action.expectedTitle)throw new AgentError('실제 대상을 확인한 삭제 제안이 필요합니다. 다시 제안받아 주세요.','CALENDAR_TARGET',409);
 const token=await accessToken(db,owner,'google_calendar',env);
 if(await calendar(token)!==v.calendarId)throw new AgentError('Google 계정이 변경되었습니다. 현재 계정으로 다시 제안받아 주세요.','CONFLICT',409);
 const row=await db.prepare("SELECT result_json FROM orbit_agent_actions WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(owner,id,lease).first<{result_json:string}>();
 if(!row)throw new AgentError('삭제 실행 상태가 변경됐습니다.','CONFLICT',409);
 const previous=JSON.parse(row.result_json).calendarDeletion;
 const attempted=previous?.seriesId===v.seriesId&&previous?.calendarId===v.calendarId&&previous?.etag===v.etag;
 const checkpoint=async(status:string,message:string)=>{
  const result={calendarDeletion:{...v,status,message,attemptedAt:previous?.attemptedAt??new Date().toISOString(),...(status==='verified'?{verifiedAt:new Date().toISOString()}:{} )}};
  const saved=await db.prepare("UPDATE orbit_agent_actions SET result_json=? WHERE owner_id=? AND id=? AND state='applying' AND updated_at=?").bind(JSON.stringify(result),owner,id,lease).run();
  if(saved.meta?.changes!==1)throw new AgentError('삭제 실행 상태가 변경됐습니다.','CONFLICT',409);return result;
 };
 const live=await get(token,v.calendarId,v.seriesId);
 const absent=live.response.status===404||live.response.status===410||(live.response.ok&&live.data.status==='cancelled');
 if(!absent){
  check(live.response);master(live.data,v.title);
  if(live.data.id!==v.seriesId||live.data.etag!==v.etag||live.data.iCalUID!==v.iCalUID)throw new AgentError('승인 대상의 내용이 변경되어 삭제하지 않았습니다. 다시 제안받아 주세요.','CONFLICT',409);
  await checkpoint('attempted','삭제 요청의 결과를 확인 중입니다. 기존 할 일은 변경하지 않습니다.');
  const deletion=await fetchJson(path(v.calendarId,v.seriesId)+'?sendUpdates=none',{method:'DELETE',headers:{Authorization:`Bearer ${token}`,'If-Match':v.etag}});
  check(deletion.response);
  await checkpoint('deleted','Google이 삭제를 접수했습니다. 향후 회차 검증이 남았습니다.');
 }else if(!attempted){throw new AgentError('대상이 이미 없거나 접근할 수 없습니다. 이번 요청으로 삭제했다고 기록하지 않았습니다.','CALENDAR_TARGET',409);}
 // Re-query the master and future instances. Never interpret denied access as absence.
 try{
  const after=await get(token,v.calendarId,v.seriesId);
  if(after.response.status!==404&&after.response.status!==410){check(after.response);if(after.data.status!=='cancelled')throw new Error('master remains');}
  const future=new URL(path(v.calendarId,v.seriesId)+'/instances');future.search=new URLSearchParams({timeMin:new Date().toISOString(),showDeleted:'false',maxResults:'2500'}).toString();
  const instances=await fetchJson(future.href,{headers:{Authorization:`Bearer ${token}`}});
  if(instances.response.status!==404&&instances.response.status!==410){check(instances.response);if(!Array.isArray(instances.data.items)||instances.data.items.some((e:any)=>e.status!=='cancelled')||instances.data.nextPageToken)throw new Error('instances remain');}
  // A deleted master can make instances return 404. Also query the calendar by iCalUID.
  const list=new URL(`${base}/calendars/${encodeURIComponent(v.calendarId)}/events`);list.search=new URLSearchParams({iCalUID:v.iCalUID,timeMin:new Date().toISOString(),singleEvents:'true',showDeleted:'false',maxResults:'2500'}).toString();
  const remaining=await fetchJson(list.href,{headers:{Authorization:`Bearer ${token}`}});check(remaining.response);
  if(!Array.isArray(remaining.data.items)||remaining.data.items.some((e:any)=>e.status!=='cancelled')||remaining.data.nextPageToken)throw new Error('future records remain or incomplete');
  return await checkpoint('verified','반복 시리즈 전체 삭제 후 Google 재조회 완료 · 향후 회차 없음 · 기존 할 일 변경 없음');
 }catch(error){
  await checkpoint('verification_pending','삭제 후 재조회가 완료되지 않았습니다. 같은 카드에서 결과 확인을 다시 시도해 주세요.');
  if(error instanceof AgentError&&error.code==='RECONNECT')throw error;
  throw new AgentError('삭제 요청 후 향후 회차 검증을 끝내지 못했습니다. 같은 카드에서 다시 시도하면 저장된 대상을 재조회합니다. 기존 할 일은 변경하지 않았습니다.','CALENDAR_VERIFY',502);
 }
}
