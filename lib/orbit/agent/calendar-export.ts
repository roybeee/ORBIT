import {readWorkspace,type Database} from '../../../db/repository.ts';
import type {Runtime} from './integrations.ts';
import {createGoogleEvent,syncCalendar} from './calendar.ts';
import {AgentError} from './errors.ts';
export interface CalendarExport {eventId:string;status:'publishing'|'verified'|'uncertain';fingerprint:string;url?:string;verifiedAt?:string;message?:string;leaseUntil?:number}
export async function calendarExports(db:Database,owner:string){const {results}=await db.prepare('SELECT state_json FROM orbit_calendar_exports WHERE owner_id=?').bind(owner).all<{state_json:string}>();return results.map(r=>JSON.parse(r.state_json) as CalendarExport);}
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function exportFocus(db:Database,owner:string,env:Runtime,eventId:string){
 const snapshot=await readWorkspace(db,owner),event=snapshot.data.events.find(e=>e.id===eventId),item=snapshot.data.proposals.flatMap(p=>p.items).find(i=>'approved:'+i.id===eventId&&i.state==='approved');
 if(!event||!eventId.startsWith('approved:')||!item||event.kind!=='focus')throw new AgentError('현재 승인된 집중 시간만 Google에 등록할 수 있습니다.','CONFLICT',409);
 const input={title:event.title,date:event.date,start:event.start,end:event.end,timeZone:snapshot.data.preferences.timeZone,description:'Orbit에서 승인한 집중 시간'},fingerprint=await digest(JSON.stringify(input));
 const old=await db.prepare('SELECT state_json FROM orbit_calendar_exports WHERE owner_id=? AND event_id=?').bind(owner,eventId).first<{state_json:string}>(),previous:CalendarExport|undefined=old?JSON.parse(old.state_json):undefined;
 if(previous?.fingerprint&&previous.fingerprint!==fingerprint)throw new AgentError('등록을 시도한 이후 집중 시간이 변경되었습니다. Google의 기존 일정을 먼저 확인해 주세요.','CONFLICT',409);
 if((previous?.leaseUntil??0)>Date.now())throw new AgentError('등록 결과를 확인하고 있습니다. 잠시 뒤 다시 확인해 주세요.','BUSY',409);
 const state:CalendarExport={...previous,eventId,fingerprint,status:'publishing',leaseUntil:Date.now()+180000};
 const leaseState=JSON.stringify(state);
 const claim=old?await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=? AND EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=?)').bind(leaseState,owner,eventId,old.state_json,owner,snapshot.revision).run():await db.prepare('INSERT OR IGNORE INTO orbit_calendar_exports(owner_id,event_id,state_json) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM orbit_workspaces WHERE owner_id=? AND revision=?)').bind(owner,eventId,leaseState,owner,snapshot.revision).run();if(claim.meta?.changes!==1)throw new AgentError('다른 등록 요청을 확인 중입니다.','BUSY',409);
 try{const actionId=await digest(owner+'\0'+eventId),result=await createGoogleEvent(db,owner,env,actionId,{type:'google.event.create',event:input},undefined,{internalEventId:eventId,leaseState});state.status='verified';state.url=result.url;state.verifiedAt=new Date().toISOString();state.message='Google 등록 확인 · Orbit 승인 취소와 Google 삭제는 별개입니다.';}
 catch(e){state.status='uncertain';state.message=e instanceof AgentError?e.message:'등록 응답을 확인하지 못했습니다. 같은 버튼으로 재확인해 주세요.';throw e;}
 finally{state.leaseUntil=0;await db.prepare('UPDATE orbit_calendar_exports SET state_json=? WHERE owner_id=? AND event_id=? AND state_json=?').bind(JSON.stringify(state),owner,eventId,leaseState).run();}
 try{await syncCalendar(db,owner,env,event.date)}catch{}return state;
}
