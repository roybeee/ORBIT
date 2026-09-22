import type {Database} from '../../../db/repository.ts';
import {accessToken,fetchJson,type Runtime} from './integrations.ts';
import {AgentError} from './errors.ts';
import type {CalendarDelivery} from './calendar-outbox.ts';
import type {GoogleCalendarEntry,GoogleEvent} from './calendar.ts';
// Patch only the selected resource's color. Never copy a Google event or change
// its title, times, guests, attachments or recurrence rule to update appearance.
export async function deliverGoogleColor(db:Database,owner:string,env:Runtime,original:string){
 const state=JSON.parse(original) as CalendarDelivery,target=state.googleColor!;
 state.status='publishing';state.leaseUntil=Date.now()+60000;
 let lease=JSON.stringify(state);
 const claim=await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(lease,owner,state.eventId,original).run();
 if(claim.meta?.changes!==1)return;
 try{
  const token=await accessToken(db,owner,'google_calendar',env),headers={Authorization:'Bearer '+token};
  const calendar=await fetchJson<GoogleCalendarEntry>('https://www.googleapis.com/calendar/v3/users/me/calendarList/'+encodeURIComponent(target.calendarId),{headers},6000);
  if(!calendar.response.ok||!calendar.data.id)throw new AgentError('Google 캘린더 연결을 확인해 주세요. 색상 변경은 보관되어 있습니다.','RECONNECT',409);
  if(!['owner','writer'].includes(calendar.data.accessRole))throw new AgentError('읽기 전용 캘린더라 Google 색상을 변경할 수 없습니다. ORBIT 색상은 유지됩니다.','CALENDAR_READ_ONLY',409);
  if(state.calendarId&&state.calendarId!==calendar.data.id)throw new AgentError('색상을 변경하던 Google 계정과 다릅니다. 원래 계정을 연결해 주세요.','CONFLICT',409);
  state.calendarId=calendar.data.id;
  const bound=JSON.stringify(state),binding=await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(bound,owner,state.eventId,lease).run();
  if(binding.meta?.changes!==1)throw new AgentError('새 색상 변경이 접수되어 다시 확인합니다.','CONFLICT',409);lease=bound;
  const url='https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(state.calendarId!)+'/events/'+encodeURIComponent(target.eventId);
  const current=await fetchJson<GoogleEvent>(url,{headers},6000);
  if([404,410].includes(current.response.status)||current.data.status==='cancelled'){state.status='cancelled';state.message='삭제된 일정의 색상 변경을 중단했습니다.';return}
  if(!current.response.ok||current.data.id!==target.eventId||!current.data.etag)throw new AgentError('Google 일정을 확인하지 못했습니다. 색상을 자동으로 다시 반영합니다.','CALENDAR',502);
  if(current.data.recurrence?.length&&!current.data.recurringEventId)throw new AgentError('반복 일정은 선택한 회차에서 색상을 바꿔 주세요.','INPUT',409);
  let saved=current.data;
  if(String(saved.colorId??'')!==target.colorId){
   if(state.leaseUntil<Date.now()+6500)throw new AgentError('연결을 다시 확인한 뒤 색상을 반영합니다.','BUSY',409);
   const changed=await fetchJson<GoogleEvent>(url+'?sendUpdates=none',{method:'PATCH',headers:{...headers,'Content-Type':'application/json','If-Match':current.data.etag},body:JSON.stringify({colorId:target.colorId})},6000);
   if(!changed.response.ok)throw new AgentError(changed.response.status===403?'Google 색상 수정 권한을 확인해 주세요.':'Google 색상 반영을 확인하지 못했습니다. 자동으로 다시 확인합니다.','CALENDAR',502);
   saved=changed.data;
  }
  if(saved.id!==target.eventId||String(saved.colorId??'')!==target.colorId)throw new AgentError('Google 색상 저장 결과를 다시 확인합니다.','CALENDAR',502);
  state.status='verified';state.verifiedAt=new Date().toISOString();state.message='Google 색상 반영 완료';
 }catch(error){state.status='uncertain';state.message=error instanceof AgentError?error.message:'Google 색상을 자동으로 다시 반영합니다.';}
 finally{state.leaseUntil=0;await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(JSON.stringify({...state,attemptedAt:new Date().toISOString()}),owner,state.eventId,lease).run()}
}
